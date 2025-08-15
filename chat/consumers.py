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
        if room is None and '-' not in self.room_name:
            logger.warning(f"Sala {self.room_name} não encontrada")
            await self.close(code=4004)
            return

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

        if room:
            is_admin = await self.is_admin_or_creator(room, self.user)
            await self.send(text_data=json.dumps({
                'type': 'room_state_update',
                'is_muted': room.is_muted,
                'is_admin': is_admin
            }))

        cache.set(self.room_group_name, current_users_count + 1)

        if self.room_group_name not in self.connected_users:
            self.connected_users[self.room_group_name] = set()
        self.connected_users[self.room_group_name].add(self.user.username)

        await self.update_last_seen()
        logger.info(f"Usuário {self.user.username} conectou à sala {self.room_name}, last_seen atualizado")

        if '-' not in self.room_name:
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

        if '-' not in self.room_name:
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

        action = text_data_json.get('action')

        if action == 'delete_message':
            message_id = text_data_json.get('message_id')
            scope = text_data_json.get('scope')

            if scope == 'for_me' and message_id:
                await self.delete_message_for_me(message_id)
                await self.send(text_data=json.dumps({
                    'type': 'message_deleted_for_me',
                    'message_id': message_id
                }))
            elif scope == 'for_everyone' and message_id:
                deleted_by_author, error_message = await self.delete_message_for_everyone(message_id)
                if deleted_by_author:
                    await self.channel_layer.group_send(
                        self.room_group_name,
                        {
                            'type': 'message_deleted_for_everyone',
                            'message_id': message_id,
                            'deleted_by_admin': False
                        }
                    )
                elif error_message:
                    await self.send(text_data=json.dumps({
                        'type': 'system_message',
                        'message': error_message
                    }))
            elif scope == 'admin_delete' and message_id:
                room = await self.get_room()
                is_admin = await self.is_admin_or_creator(room, self.user)
                if is_admin:
                    deleted, error_message = await self.delete_message_by_admin(message_id)
                    if deleted:
                        await self.channel_layer.group_send(
                            self.room_group_name,
                            {
                                'type': 'message_deleted_for_everyone',
                                'message_id': message_id,
                                'deleted_by_admin': True,
                                'admin_username': self.user.username
                            }
                        )
                    elif error_message:
                        await self.send(text_data=json.dumps({
                            'type': 'system_message',
                            'message': error_message
                        }))
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
            if room and room.is_muted and not await self.is_admin_or_creator(room, self.user):
                await self.send(text_data=json.dumps({
                    'type': 'system_message',
                    'message': 'A sala está mutada. Apenas administradores podem enviar mensagens.'
                }))
                return

            parent_id = text_data_json.get('reply_to')
            chat_message_obj = await self.save_message(self.user, self.room_name, message, parent_id)
            
            avatar_url = await self.get_avatar_url(self.user)

            parent_info = None
            if chat_message_obj.parent:
                parent_info = {
                    'author': chat_message_obj.parent.author.username,
                    'content': chat_message_obj.parent.content,
                }
            
            await self.channel_layer.group_send(
                self.room_group_name, {
                    'type': 'chat_message',
                    'id': chat_message_obj.id,
                    'message': chat_message_obj.content,
                    'username': username,
                    'timestamp': chat_message_obj.timestamp.strftime('%H:%M'),
                    'avatar_url': avatar_url,
                    'parent': parent_info,
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
                await self.broadcast_user_list()

            elif admin_action == 'demote' and target_username:
                await self.demote_user(room, target_username)
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {'type': 'system_message', 'message': f'{target_username} foi rebaixado de administrador.'}
                )
                await self.broadcast_user_list()

            elif admin_action == 'mute':
                await self.set_room_mute(room, True)
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'mute_status_update',
                        'is_muted': True,
                        'message': 'A sala foi mutada por um administrador.'
                    }
                )

            elif admin_action == 'unmute':
                await self.set_room_mute(room, False)
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'mute_status_update',
                        'is_muted': False,
                        'message': 'A sala foi desmutada por um administrador.'
                    }
                )

    async def chat_message(self, event): await self.send(text_data=json.dumps(event))
    async def system_message(self, event): await self.send(text_data=json.dumps(event))
    async def user_list_update(self, event): await self.send(text_data=json.dumps(event))
    async def typing_signal(self, event): await self.send(text_data=json.dumps(event))
    async def heartbeat(self, event): await self.send(text_data=json.dumps(event))
    async def user_status_update(self, event): await self.send(text_data=json.dumps(event))
    async def message_deleted_for_me(self, event): await self.send(text_data=json.dumps(event))
    async def message_deleted_for_everyone(self, event): await self.send(text_data=json.dumps(event))

    async def room_state_update(self, event):
        await self.send(text_data=json.dumps(event))

    async def mute_status_update(self, event):
        await self.send(text_data=json.dumps(event))

    async def admin_status_update(self, event):
        target_username = event.get('target_username')
        if self.user.username == target_username:
            await self.send(text_data=json.dumps({
                'type': 'admin_status_update',
                'is_admin': event.get('is_admin')
            }))

    async def broadcast_user_list(self):
        connected_usernames = self.connected_users.get(self.room_group_name, set())
        profiles = await self.get_profiles_in_room(connected_usernames)
        await self.channel_layer.group_send(
            self.room_group_name, {
                'type': 'user_list_update',
                'users': profiles
            }
        )

    @database_sync_to_async
    def get_profiles_in_room(self, connected_usernames):
        user_list = []
        usernames = set()
        past_users = ChatMessage.objects.filter(room_name=self.room_name).values_list('author__username', flat=True).distinct()
        usernames.update(past_users)
        usernames.update(connected_usernames)

        try:
            room = ChatRoom.objects.get(name=self.room_name)
        except ChatRoom.DoesNotExist:
            room = None

        for username in usernames:
            try:
                user = User.objects.select_related('profile').get(username=username)
                last_seen = user.profile.last_seen
                is_online = (timezone.now() - last_seen).total_seconds() < 45 if last_seen else False
                is_creator = room and room.creator == user
                is_admin = room and user in room.admins.all()

                user_list.append({
                    'username': user.username,
                    'avatar_url': user.profile.avatar.url,
                    'is_online': is_online, 
                    'last_seen': last_seen.strftime('%d/%m às %H:%M') if last_seen else 'Nunca',
                    'is_creator': is_creator,
                    'is_admin': is_admin
                })
            except (User.DoesNotExist, Profile.DoesNotExist): continue
        return user_list

    @database_sync_to_async
    def get_room_sync(self):
        try: return ChatRoom.objects.get(name=self.room_name)
        except ChatRoom.DoesNotExist: return None

    @database_sync_to_async
    def update_last_seen(self):
        try: Profile.objects.filter(user=self.user).update(last_seen=timezone.now())
        except Exception as e: logger.error(f"Erro ao atualizar last_seen para {self.user.username}: {str(e)}")

    @database_sync_to_async
    def save_message(self, user, room, message, parent_id=None):
        parent_message = None
        if parent_id:
            try:
                parent_message = ChatMessage.objects.select_related('author').get(id=parent_id)
            except ChatMessage.DoesNotExist:
                pass
        return ChatMessage.objects.create(author=user, room_name=room, content=message, parent=parent_message)

    @database_sync_to_async
    def get_avatar_url(self, user):
        try:
            return user.profile.avatar.url
        except Profile.DoesNotExist:
            return Profile._meta.get_field('avatar').get_default()

    @database_sync_to_async
    def get_room(self):
        try: return ChatRoom.objects.get(name=self.room_name)
        except ChatRoom.DoesNotExist: return None

    @database_sync_to_async
    def is_user_banned(self, room, user):
        if room is None:
            return False
        return ChatRoomBan.objects.filter(room=room, banned_user=user).exists()

    @database_sync_to_async
    def kick_user(self, room, target_username):
        if room is None: return
        try:
            target_user = User.objects.get(username=target_username)
            ChatRoomBan.objects.get_or_create(room=room, banned_user=target_user)
        except User.DoesNotExist: pass

    @database_sync_to_async
    def _promote_user_db(self, room, target_username):
        if room is None: return
        try:
            new_admin = User.objects.get(username=target_username)
            room.admins.add(new_admin)
        except User.DoesNotExist: pass

    async def promote_user(self, room, target_username):
        await self._promote_user_db(room, target_username)
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'admin_status_update',
                'target_username': target_username,
                'is_admin': True
            }
        )

    @database_sync_to_async
    def _demote_user_db(self, room, target_username):
        if room is None: return
        try:
            admin_to_demote = User.objects.get(username=target_username)
            room.admins.remove(admin_to_demote)
        except User.DoesNotExist: pass

    async def demote_user(self, room, target_username):
        await self._demote_user_db(room, target_username)
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'admin_status_update',
                'target_username': target_username,
                'is_admin': False
            }
        )

    @database_sync_to_async
    def set_room_mute(self, room, state):
        if room is None: return
        room.is_muted = state
        room.save()

    @database_sync_to_async
    def is_admin_or_creator(self, room, user):
        if room is None:
            return False
        return room.creator == user or user in room.admins.all()

    @database_sync_to_async
    def delete_message_for_me(self, message_id):
        try:
            message = ChatMessage.objects.get(id=message_id)
            message.deleted_by.add(self.user)
        except ChatMessage.DoesNotExist:
            logger.warning(f"Tentativa de apagar mensagem inexistente com ID {message_id}")

    @database_sync_to_async
    def delete_message_for_everyone(self, message_id):
        try:
            message = ChatMessage.objects.get(id=message_id)
            if self.user == message.author:
                time_diff = timezone.now() - message.timestamp
                if time_diff.total_seconds() <= 300:
                    message.is_deleted_for_everyone = True
                    message.save()
                    return True, None
                else:
                    return False, "Você só pode apagar mensagens em até 5 minutos."
            return False, "Você só pode apagar suas próprias mensagens."
        except ChatMessage.DoesNotExist:
            logger.warning(f"Tentativa de apagar mensagem inexistente com ID {message_id}")
            return False, "Mensagem não encontrada."

    @database_sync_to_async
    def delete_message_by_admin(self, message_id):
        try:
            message = ChatMessage.objects.get(id=message_id)
            time_diff = timezone.now() - message.timestamp
            if time_diff.total_seconds() <= 300:
                message.is_deleted_for_everyone = True
                message.deleted_by_admin = self.user
                message.save()
                return True, None
            else:
                return False, "Admins só podem apagar mensagens em até 5 minutos."
        except ChatMessage.DoesNotExist:
            logger.warning(f"Tentativa de apagar mensagem inexistente com ID {message_id}")
            return False, "Mensagem não encontrada."