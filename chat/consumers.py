# consumers.py

import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.core.cache import cache
from django.contrib.auth.models import User
from .models import ChatMessage, Profile, ChatRoom, ChatRoomBan
from django.utils import timezone
import logging

logger = logging.getLogger(__name__)

class ChatConsumer(AsyncWebsocketConsumer):
    connected_users = {}

    async def connect(self):
        self.room_name = self.scope['url_route']['kwargs']['room_name']
        self.user = self.scope['user']
        safe_room_name = ''.join(e for e in self.room_name if e.isalnum() or e in ['-', '_']).lower()
        self.room_group_name = f'chat_{safe_room_name}'

        if not self.user.is_authenticated:
            logger.warning(f"Usuário não autenticado tentou conectar à sala {self.room_name}")
            await self.close()
            return

        room = await self.get_room()
        # Esta verificação está correta para DMs, pois '-' in self.room_name será true,
        # então a condição do if será falsa e a conexão continuará.
        if room is None and '-' not in self.room_name:
            logger.warning(f"Sala {self.room_name} não encontrada")
            await self.close(code=4004)
            return

        # A chamada a is_user_banned agora é segura por causa da correção na função
        is_banned = await self.is_user_banned(room, self.user)
        if is_banned:
            logger.warning(f"Usuário {self.user.username} foi banido da sala {room.name}")
            await self.close(code=4001)
            return

        current_users_count = len(self.connected_users.get(self.room_group_name, set()))
        if room and current_users_count >= room.user_limit:
            logger.warning(f"Limite de usuários atingido na sala {self.room_name}")
            await self.close(code=4003)
            return

        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()

        cache.set(self.room_group_name, current_users_count + 1)

        if self.room_group_name not in self.connected_users:
            self.connected_users[self.room_group_name] = set()
        self.connected_users[self.room_group_name].add(self.user.username)

        await self.update_last_seen()
        logger.info(f"Usuário {self.user.username} conectou à sala {self.room_name}, last_seen atualizado")

        # Não é necessário enviar mensagem de sistema de entrada/saída para DMs, mas mantendo por simplicidade.
        # Em uma melhoria futura, poderia ser envolvido por: if not '-' in self.room_name:
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'system_message',
                'message': f'{self.user.username} entrou na sala.'
            }
        )

        await self.broadcast_user_list()

    async def disconnect(self, close_code):
        if self.room_group_name in self.connected_users:
            self.connected_users[self.room_group_name].discard(self.user.username)

        await self.update_last_seen()
        logger.info(f"Usuário {self.user.username} desconectou da sala {self.room_name}, last_seen atualizado")

        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'system_message',
                'message': f'{self.user.username} saiu da sala.'
            }
        )

        await self.broadcast_user_list()
        await self.channel_layer.group_discard(self.room_group_name, self.channel_name)

    async def receive(self, text_data):
        try:
            text_data_json = json.loads(text_data)
        except json.JSONDecodeError:
            logger.error(f"Erro ao decodificar JSON: {text_data}")
            return

        username = self.user.username
        message = text_data_json.get('message')
        is_typing = text_data_json.get('is_typing')
        heartbeat = text_data_json.get('heartbeat')
        admin_action = text_data_json.get('admin_action')

        if heartbeat:
            await self.update_last_seen()
            logger.info(f"Heartbeat recebido de {username}, last_seen atualizado")
            await self.send(text_data=json.dumps({
                'type': 'heartbeat',
                'status': 'pong'
            }))
            await self.broadcast_user_list()
        elif message:
            room = await self.get_room()
            # A verificação 'if room' protege a lógica de mute para DMs
            if room and room.is_muted and not await self.is_admin_or_creator(room, self.user):
                await self.send(text_data=json.dumps({
                    'type': 'system_message',
                    'message': 'A sala está mutada. Apenas administradores podem enviar mensagens.'
                }))
                return
            chat_message_obj = await self.save_message(self.user, self.room_name, message)
            avatar_url = await self.get_avatar_url(self.user)
            await self.channel_layer.group_send(
                self.room_group_name, {
                    'type': 'chat_message',
                    'message': chat_message_obj.content,
                    'username': username,
                    'timestamp': chat_message_obj.timestamp.strftime('%H:%M'),
                    'avatar_url': avatar_url,
                }
            )
        elif is_typing is not None:
            await self.channel_layer.group_send(
                self.room_group_name, {
                    'type': 'typing_signal',
                    'username': username,
                    'is_typing': is_typing
                }
            )
        elif admin_action:
            room = await self.get_room()
            is_admin = await self.is_admin_or_creator(room, self.user)
            if not is_admin:
                await self.send(text_data=json.dumps({
                    'type': 'system_message',
                    'message': 'Você não tem permissão de administrador.'
                }))
                return

            target_username = text_data_json.get('target')

            if admin_action == 'kick' and target_username:
                await self.kick_user(room, target_username)
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {'type': 'system_message', 'message': f'{target_username} foi expulso da sala pelo admin.'}
                )

            elif admin_action == 'promote' and target_username:
                await self.promote_user(room, target_username)
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {'type': 'system_message', 'message': f'{target_username} foi promovido a administrador.'}
                )

            elif admin_action == 'mute':
                await self.set_room_mute(room, True)
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {'type': 'system_message', 'message': 'A sala foi mutada por um administrador.'}
                )

            elif admin_action == 'unmute':
                await self.set_room_mute(room, False)
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {'type': 'system_message', 'message': 'A sala foi desmutada por um administrador.'}
                )

    async def chat_message(self, event): await self.send(text_data=json.dumps(event))
    async def system_message(self, event): await self.send(text_data=json.dumps(event))
    async def user_list_update(self, event): await self.send(text_data=json.dumps(event))
    async def typing_signal(self, event): await self.send(text_data=json.dumps(event))
    async def heartbeat(self, event): await self.send(text_data=json.dumps(event))

    async def broadcast_user_list(self):
        profiles = await self.get_profiles_in_room()
        await self.channel_layer.group_send(
            self.room_group_name, {
                'type': 'user_list_update',
                'users': profiles
            }
        )

    @database_sync_to_async
    def get_profiles_in_room(self):
        user_list = []
        usernames = set()
        past_users = ChatMessage.objects.filter(room_name=self.room_name).values_list('author__username', flat=True).distinct()
        usernames.update(past_users)
        if self.room_group_name in self.connected_users:
            usernames.update(self.connected_users[self.room_group_name])
        for username in usernames:
            try:
                user = User.objects.select_related('profile').get(username=username)
                last_seen = user.profile.last_seen
                is_online = (timezone.now() - last_seen).total_seconds() < 60
                user_list.append({
                    'username': user.username, 'avatar_url': user.profile.avatar.url,
                    'is_online': is_online, 'last_seen': last_seen.strftime('%d/%m às %H:%M') if last_seen else 'Nunca'
                })
            except (User.DoesNotExist, Profile.DoesNotExist): continue
        return user_list

    @database_sync_to_async
    def update_last_seen(self):
        try: Profile.objects.filter(user=self.user).update(last_seen=timezone.now())
        except Exception as e: logger.error(f"Erro ao atualizar last_seen para {self.user.username}: {str(e)}")

    @database_sync_to_async
    def save_message(self, user, room, message):
        return ChatMessage.objects.create(author=user, room_name=room, content=message)

    @database_sync_to_async
    def get_avatar_url(self, user):
        try: return user.profile.avatar.url
        except (Profile.DoesNotExist, ValueError): return '/media/avatars/default.jpg'

    @database_sync_to_async
    def get_room(self):
        try: return ChatRoom.objects.get(name=self.room_name)
        except ChatRoom.DoesNotExist: return None

    # --- ALTERADO: Adicionada verificação para `room is None` ---
    @database_sync_to_async
    def is_user_banned(self, room, user):
        if room is None: # DMs não têm banimento
            return False
        return ChatRoomBan.objects.filter(room=room, banned_user=user).exists()

    @database_sync_to_async
    def kick_user(self, room, target_username):
        if room is None: return # Não pode expulsar de uma DM
        try:
            target_user = User.objects.get(username=target_username)
            ChatRoomBan.objects.get_or_create(room=room, banned_user=target_user)
        except User.DoesNotExist: pass

    @database_sync_to_async
    def promote_user(self, room, target_username):
        if room is None: return # Não pode promover em uma DM
        try:
            new_admin = User.objects.get(username=target_username)
            room.admin_user = new_admin
            room.save()
        except User.DoesNotExist: pass

    @database_sync_to_async
    def set_room_mute(self, room, state):
        if room is None: return # DMs não podem ser mutadas
        room.is_muted = state
        room.save()

    # --- ALTERADO: Adicionada verificação para `room is None` ---
    @database_sync_to_async
    def is_admin_or_creator(self, room, user):
        if room is None: # DMs não têm admins ou criadores formais
            return False
        return (
            room.creator_id == user.id or
            (room.admin_user_id == user.id if room.admin_user_id else False)
        )