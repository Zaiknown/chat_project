# ARQUIVO: chat/consumers.py

import json
import secrets
from urllib.parse import parse_qs
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.core.cache import cache
from django.contrib.auth.models import User
from .models import ChatMessage, Profile, ChatRoom, ChatRoomBan, ChatRoomMute
from django.utils import timezone
import logging

logger = logging.getLogger(__name__)

class ChatConsumer(AsyncWebsocketConsumer):
    connected_users = {}

    async def connect(self):
        self.room_slug = self.scope['url_route']['kwargs']['room_slug']
        self.user = self.scope['user']
        self.left_explicitly = False
        self.room_group_name = f'chat_{self.room_slug}'

        if not self.user.is_authenticated:
            logger.warning(f"Usuário não autenticado tentou conectar à sala {self.room_slug}")
            await self.close()
            return

        room = await self.get_room()
        
        # Validação para salas públicas que não existem
        if room is None and not self.room_slug.startswith('dm-'):
            logger.warning(f"Sala {self.room_slug} não encontrada")
            await self.close(code=4004)
            return

        # Lógica específica para salas públicas (que possuem um objeto 'room')
        if room:
            if room.password:
                # (A sua lógica de verificação de token de senha permanece aqui, se aplicável)
                pass

            self.banned_user = await self.is_user_banned(room, self.user)
            if self.banned_user:
                logger.warning(f"Usuário {self.user.username} foi banido da sala {room.name}")
                await self.close(code=4001)
                return

            current_users_count = len(self.connected_users.get(self.room_group_name, {}))
            if hasattr(room, 'user_limit') and room.user_limit and current_users_count >= room.user_limit:
                logger.warning(f"Limite de usuários atingido na sala {self.room_slug}")
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

        if self.room_group_name not in self.connected_users:
            self.connected_users[self.room_group_name] = {}
        self.connected_users[self.room_group_name][self.user.username] = self.channel_name

        await self.update_last_seen()
        logger.info(f"Usuário {self.user.username} conectou à sala {self.room_slug}, last_seen atualizado")

        if not self.room_slug.startswith('dm-'):
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'system_message',
                    'message': f'{self.user.username} entrou na sala.'
                }
            )

        await self.broadcast_user_list()

    async def disconnect(self, close_code):
        if self.room_group_name in self.connected_users and self.user.username in self.connected_users[self.room_group_name]:
            del self.connected_users[self.room_group_name][self.user.username]

        await self.update_last_seen()
        logger.info(f"Usuário {self.user.username} desconectou da sala {self.room_slug}, last_seen atualizado")

        if not self.left_explicitly and not self.room_slug.startswith('dm-') and not getattr(self, 'banned_user', False) and not getattr(self, 'kicked', False):
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
            message_type = text_data_json.get('type')
        except json.JSONDecodeError:
            logger.error(f"Erro ao decodificar JSON: {text_data}")
            return

        if message_type == 'leave_chat':
            await self.leave_chat(text_data_json)
            return
        elif message_type == 'admin_action':
            await self.handle_admin_action(text_data_json)
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

        if heartbeat:
            await self.update_last_seen()
            await self.send(text_data=json.dumps({'type': 'heartbeat','status': 'pong'}))
            await self.broadcast_user_list()
        elif message:
            room = await self.get_room()
            if room and room.is_muted and not await self.is_admin_or_creator(room, self.user):
                await self.send(text_data=json.dumps({
                    'type': 'system_message',
                    'message': 'A sala está mutada. Apenas administradores podem enviar mensagens.'
                }))
                return

            if room and await self.is_user_muted(room, self.user):
                await self.send(text_data=json.dumps({
                    'type': 'system_message',
                    'message': 'Você foi silenciado nesta sala e não pode enviar mensagens.'
                }))
                return

            parent_id = text_data_json.get('reply_to')
            room_name_to_save = room.name if room else self.room_slug
            chat_message_obj = await self.save_message(self.user, room_name_to_save, message, parent_id)
            
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
                    'timestamp': timezone.localtime(chat_message_obj.timestamp).strftime('%H:%M'),
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
        
        elif text_data_json.get('type') == 'chat_settings':
            room = await self.get_room()
            is_admin = await self.is_admin_or_creator(room, self.user)
            if not is_admin:
                await self.send(text_data=json.dumps({
                    'type': 'system_message',
                    'message': 'Você não tem permissão para alterar as configurações da sala.'
                }))
                return

            new_room_name = text_data_json.get('room_name')
            user_limit = text_data_json.get('user_limit')

            updated_room, error = await self.update_chat_settings(room, new_room_name, user_limit)

            if error:
                await self.send(text_data=json.dumps({
                    'type': 'system_message',
                    'message': error
                }))
            else:
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'system_message',
                        'message': f'As configurações da sala foram atualizadas por {self.user.username}.'
                    }
                )

    async def leave_chat(self, event):
        self.left_explicitly = True
        if not self.room_slug.startswith('dm-'):
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'system_message',
                    'message': f'{self.user.username} saiu da sala.'
                }
            )
        await self.broadcast_user_list()

    async def handle_admin_action(self, data):
        room = await self.get_room()
        is_admin = await self.is_admin_or_creator(room, self.user)
        if not is_admin:
            await self.send(text_data=json.dumps({'type': 'system_message', 'message': 'Você não tem permissão de administrador.'}))
            return

        action = data.get('action')
        target_username = data.get('target')

        if action == 'kick' and target_username:
            await self.kick_user(room, target_username)
            await self.channel_layer.group_send(
                self.room_group_name,
                {'type': 'system_message', 'message': f'{target_username} foi expulso da sala.'}
            )
            await self.broadcast_user_list()

        elif action == 'promote' and target_username:
            await self.promote_user(room, target_username)
            await self.channel_layer.group_send(
                self.room_group_name,
                {'type': 'system_message', 'message': f'{target_username} foi promovido a administrador.'}
            )
            await self.broadcast_user_list()

        elif action == 'demote' and target_username:
            await self.demote_user(room, target_username)
            await self.channel_layer.group_send(
                self.room_group_name,
                {'type': 'system_message', 'message': f'{target_username} foi rebaixado para membro.'}
            )
            await self.broadcast_user_list()

        elif action == 'mute_user' and target_username:
            try:
                target_user = await database_sync_to_async(User.objects.get)(username=target_username)
                mute_instance, created = await database_sync_to_async(ChatRoomMute.objects.get_or_create)(room=room, muted_user=target_user)
                
                if not created:
                    await database_sync_to_async(mute_instance.delete)()
                    message = f'{target_username} foi desmutado.'
                else:
                    message = f'{target_username} foi silenciado.'

                await self.channel_layer.group_send(self.room_group_name, {'type': 'system_message', 'message': message})
                await self.broadcast_user_list() 
            except User.DoesNotExist:
                await self.send(text_data=json.dumps({'type': 'system_message', 'message': f'Usuário {target_username} não encontrado.'}))

        elif action == 'toggle_mute':
            room.is_muted = not room.is_muted
            await database_sync_to_async(room.save)()
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'mute_status_update',
                    'is_muted': room.is_muted,
                    'message': f'A sala foi {"mutada" if room.is_muted else "desmutada"} por um administrador.'
                }
            )

    # ... Handlers for channel layer messages ...
    async def chat_message(self, event): await self.send(text_data=json.dumps(event))
    async def system_message(self, event): await self.send(text_data=json.dumps(event))
    async def user_list_update(self, event): await self.send(text_data=json.dumps(event))
    async def typing_signal(self, event): await self.send(text_data=json.dumps(event))
    async def message_deleted_for_everyone(self, event): await self.send(text_data=json.dumps(event))
    async def room_state_update(self, event): await self.send(text_data=json.dumps(event))
    async def mute_status_update(self, event): await self.send(text_data=json.dumps(event))

    async def admin_status_update(self, event):
        target_username = event.get('target_username')
        if self.user.username == target_username:
            await self.send(text_data=json.dumps({
                'type': 'admin_status_update',
                'is_admin': event.get('is_admin')
            }))

    async def force_disconnect(self, event):
        await self.send(text_data=json.dumps({'type': 'system_message','message': 'Você foi expulso da sala.'}))
        self.kicked = True
        await self.close(code=4001)

    async def broadcast_user_list(self):
        connected_usernames = list(self.connected_users.get(self.room_group_name, {}).keys())
        room = await self.get_room()
        profiles = await self.get_profiles_in_room(connected_usernames, room)
        await self.channel_layer.group_send(
            self.room_group_name,
            {'type': 'user_list_update', 'users': profiles}
        )

    @database_sync_to_async
    def get_profiles_in_room(self, connected_usernames, room):
        user_list = []
        usernames = set(connected_usernames)
        
        if room: # Public Room logic
            past_users = ChatMessage.objects.filter(room_name=room.name).values_list('author__username', flat=True).distinct()
            usernames.update(past_users)
            muted_users = set(ChatRoomMute.objects.filter(room=room).values_list('muted_user__username', flat=True))
        elif self.room_slug.startswith('dm-'): # DM Room logic
            participant_string = self.room_slug[3:]
            participants = participant_string.split('-')
            usernames.update(participants)
            muted_users = set()

        for username in usernames:
            try:
                user = User.objects.select_related('profile').get(username=username)
                last_seen = user.profile.last_seen
                is_online = (timezone.now() - last_seen).total_seconds() < 60 if last_seen else False
                
                user_list.append({
                    'username': user.username,
                    'avatar_url': user.profile.avatar.url,
                    'is_online': is_online, 
                    'last_seen': last_seen.strftime('%d/%m às %H:%M') if last_seen else 'Nunca',
                    'is_creator': room and room.creator == user,
                    'is_admin': room and user in room.admins.all(),
                    'is_muted': room and username in muted_users
                })
            except (User.DoesNotExist, Profile.DoesNotExist):
                continue
        return user_list

    @database_sync_to_async
    def get_room(self):
        if self.room_slug.startswith('dm-'):
            return None
        try:
            return ChatRoom.objects.get(slug=self.room_slug)
        except ChatRoom.DoesNotExist:
            return None

    @database_sync_to_async
    def update_last_seen(self):
        try:
            Profile.objects.filter(user=self.user).update(last_seen=timezone.now())
        except Exception as e:
            logger.error(f"Erro ao atualizar last_seen para {self.user.username}: {str(e)}")

    @database_sync_to_async
    def save_message(self, user, room_name, message, parent_id=None):
        parent_message = None
        if parent_id:
            try:
                parent_message = ChatMessage.objects.select_related('author').get(id=parent_id)
            except ChatMessage.DoesNotExist:
                pass
        return ChatMessage.objects.create(author=user, room_name=room_name, content=message, parent=parent_message)

    @database_sync_to_async
    def get_avatar_url(self, user):
        try:
            return user.profile.avatar.url
        except (Profile.DoesNotExist, AttributeError):
            return 'https://res.cloudinary.com/dtrfgop8f/image/upload/v1756166420/vdu6rwcppbq8zvzddkdw.jpg'

    @database_sync_to_async
    def is_user_banned(self, room, user):
        if room is None: return False
        return ChatRoomBan.objects.filter(room=room, banned_user=user).exists()

    @database_sync_to_async
    def is_user_muted(self, room, user):
        if room is None: return False
        return ChatRoomMute.objects.filter(room=room, muted_user=user).exists()

    async def kick_user(self, room, target_username):
        if room is None: return
        try:
            target_user = await database_sync_to_async(User.objects.get)(username=target_username)
            await database_sync_to_async(ChatRoomBan.objects.get_or_create)(room=room, banned_user=target_user)
            
            target_channel_name = self.connected_users.get(self.room_group_name, {}).get(target_username)
            if target_channel_name:
                if self.room_group_name in self.connected_users and target_username in self.connected_users[self.room_group_name]:
                    del self.connected_users[self.room_group_name][target_username]
                
                await self.channel_layer.send(target_channel_name, {'type': 'force_disconnect'})
        except User.DoesNotExist:
            pass

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
            {'type': 'admin_status_update', 'target_username': target_username, 'is_admin': True}
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
            {'type': 'admin_status_update', 'target_username': target_username, 'is_admin': False}
        )

    @database_sync_to_async
    def set_room_mute(self, room, state):
        if room is None: return
        room.is_muted = state
        room.save()

    @database_sync_to_async
    def is_admin_or_creator(self, room, user):
        if room is None: return False
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
            if time_diff.total_seconds() <= 300: # 5 minute window for admins too
                message.is_deleted_for_everyone = True
                message.deleted_by_admin = self.user
                message.save()
                return True, None
            else:
                return False, "Admins só podem apagar mensagens em até 5 minutos."
        except ChatMessage.DoesNotExist:
            logger.warning(f"Tentativa de apagar mensagem inexistente com ID {message_id}")
            return False, "Mensagem não encontrada."

    @database_sync_to_async
    def update_chat_settings(self, room, new_name, user_limit):
        if not room:
            return None, "Sala não encontrada."

        if new_name:
            room.name = new_name
        if user_limit is not None:
            try:
                room.user_limit = int(user_limit)
            except (ValueError, TypeError):
                return None, "Limite de usuários inválido."
        
        room.save()
        return room, None