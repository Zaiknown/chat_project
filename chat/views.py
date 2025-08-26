# ARQUIVO: chat/views.py

import secrets
from django.shortcuts import render, redirect
from django.contrib.auth.decorators import login_required
from django.contrib.auth import login
from django.contrib import messages
from django.core.cache import cache
from django.db.models import Q
from .models import ChatMessage, Profile, User, ChatRoom
from .forms import UserUpdateForm, ProfileUpdateForm, RoomCreationForm, RoomPasswordForm, UsernameSignUpForm, EmailSignUpForm
from django.http import JsonResponse
from django.utils import timezone
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
from django.utils.text import slugify

def index_view(request):
    form = RoomCreationForm()
    if request.method == 'POST':
        if not request.user.is_authenticated:
            messages.error(request, "Você precisa estar logado para criar uma sala.")
            return redirect('login')
        form = RoomCreationForm(request.POST)
        if form.is_valid():
            room = form.save(commit=False)
            room.creator = request.user
            room.save()
            messages.success(request, f"Sala '{room.name}' criada com sucesso!")
            return redirect('chat:chat_room', room_slug=room.slug)

    public_rooms = ChatRoom.objects.all().order_by('-created_at')
    for room in public_rooms:
        room.user_count = cache.get(f'chat_{room.slug}', 0)
        
    private_chats = []
    if request.user.is_authenticated:
        # Find all unique room_names for DMs involving the current user
        dm_room_names = ChatMessage.objects.filter(
            Q(author=request.user) | Q(room_name__contains=f"{request.user.username}-") | Q(room_name__endswith=f"-{request.user.username}")
        ).filter(
            room_name__contains='-'
        ).values_list('room_name', flat=True).distinct()

        other_usernames = set()
        for name in dm_room_names:
            parts = name.split('-')
            # This logic assumes only two participants and usernames don't contain '-'
            if parts[0] == request.user.username:
                other_usernames.add(parts[1])
            else:
                other_usernames.add(parts[0])

        if other_usernames:
            private_chats = Profile.objects.filter(user__username__in=other_usernames)

    context = {
        'public_rooms': public_rooms,
        'private_chats': private_chats,
        'form': form,
        'joined_rooms': request.session.get('joined_rooms', [])
    }
    return render(request, 'index.html', context)

@login_required
def join_room(request, room_slug):
    try:
        room = ChatRoom.objects.get(slug=room_slug)
    except ChatRoom.DoesNotExist:
        messages.error(request, "A sala que você tentou acessar não existe.")
        return redirect('index')

    joined_rooms = request.session.get('joined_rooms', [])
    if room.slug not in joined_rooms:
        joined_rooms.append(room.slug)
        request.session['joined_rooms'] = joined_rooms
    request.session['just_joined_room'] = room.slug
    return redirect('chat:chat_room', room_slug=room.slug)

@login_required
def leave_room(request, room_slug):
    try:
        room = ChatRoom.objects.get(slug=room_slug)
    except ChatRoom.DoesNotExist:
        messages.error(request, "A sala que você tentou sair não existe.")
        return redirect('index')

    joined_rooms = request.session.get('joined_rooms', [])
    if room.slug in joined_rooms:
        joined_rooms.remove(room.slug)
        request.session['joined_rooms'] = joined_rooms

    channel_layer = get_channel_layer()
    room_group_name = f'chat_{room.slug}'

    async_to_sync(channel_layer.group_send)(
        room_group_name,
        {
            'type': 'system_message',
            'message': f'{request.user.username} saiu da sala.'
        }
    )

    return redirect('index')

@login_required
def chat_room_view(request, room_slug):
    is_dm = '-' in room_slug
    other_user_profile = None
    room = None
    access_token = None

    if is_dm:
        participants = room_slug.split('-')
        
        if request.user.username not in participants:
            messages.error(request, "Você não tem permissão para entrar nesta conversa.")
            return redirect('index')
        
        other_username = participants[0] if participants[1] == request.user.username else participants[1]
        
        try:
            other_user = User.objects.get(username=other_username)
            other_user_profile = Profile.objects.get(user=other_user)
        except (User.DoesNotExist, Profile.DoesNotExist):
            messages.error(request, f"Usuário da conversa '{other_username}' não encontrado.")
            return redirect('index')
    else:
        try:
            room = ChatRoom.objects.get(slug=room_slug)
        except ChatRoom.DoesNotExist:
            messages.error(request, "A sala que você tentou acessar não existe.")
            return redirect('index')

    if room and room.password:
        authorized_rooms = request.session.get('authorized_rooms', [])
        
        if room.slug not in authorized_rooms:
            if request.method == 'POST':
                form = RoomPasswordForm(request.POST)
                if form.is_valid() and form.cleaned_data['password'] == room.password:
                    authorized_rooms.append(room.slug)
                    request.session['authorized_rooms'] = authorized_rooms
                    
                    token = secrets.token_urlsafe(16)
                    room_tokens = request.session.get('room_tokens', {})
                    room_tokens[room.slug] = token
                    request.session['room_tokens'] = room_tokens
                    
                    return redirect('chat:chat_room', room_slug=room.slug)
                else:
                    messages.error(request, "Senha incorreta!")
            return render(request, 'password_prompt.html', {'room': room, 'form': RoomPasswordForm()})
        
        room_tokens = request.session.get('room_tokens', {})
        access_token = room_tokens.get(room.slug)
        if not access_token:
            access_token = secrets.token_urlsafe(16)
            room_tokens[room.slug] = access_token
            request.session['room_tokens'] = room_tokens
        
    chat_messages_qs = ChatMessage.objects.filter(room_name=room.name if room else room_slug).select_related('author__profile', 'parent__author').exclude(deleted_by=request.user).order_by('timestamp')[:50]
    
    messages_list = []
    for message in chat_messages_qs:
        parent_info = None
        if message.parent:
            parent_info = {
                'author': message.parent.author.username,
                'content': message.parent.content,
            }

        messages_list.append({
            'id': message.id,
            'author_username': message.author.username,
            'content': message.content,
            'timestamp': timezone.localtime(message.timestamp).strftime('%H:%M'),
            'avatar_url': message.author.profile.avatar.url,
            'is_sent_by_user': message.author == request.user,
            'parent': parent_info,
        })
    
    display_name = other_user_profile.user.username if is_dm else room.name

    context = {
        'room_name': room.name if room else None,
        'room_slug': room_slug,
        'display_name': display_name,
        'chat_messages': messages_list,
        'is_dm': is_dm,
        'other_user_profile': other_user_profile,
        'room': room,
        'is_admin': room.creator == request.user or request.user in room.admins.all() if room else False,
        'access_token': access_token,
    }
    return render(request, 'chat_room.html', context)

@login_required
def room_status_view(request, room_slug):
    if '-' in room_slug:
        return JsonResponse({'is_muted': False})
    try:
        room = ChatRoom.objects.get(slug=room_slug)
        return JsonResponse({'is_muted': room.is_muted})
    except ChatRoom.DoesNotExist:
        return JsonResponse({'error': 'Sala não encontrada'}, status=404)

def register_view(request):
    if request.user.is_authenticated:
        return redirect('index')

    if request.method == 'POST':
        form_type = request.POST.get('form_type')
        if form_type == 'username':
            form = UsernameSignUpForm(request.POST)
            email_form = EmailSignUpForm()
            if form.is_valid():
                user = form.save()
                login(request, user, backend='chat.backends.EmailOrUsernameModelBackend')
                messages.success(request, 'Cadastro realizado com sucesso! Você já está logado.')
                return redirect('index')
        else:
            email_form = EmailSignUpForm(request.POST)
            form = UsernameSignUpForm()
            if email_form.is_valid():
                user = email_form.save()
                login(request, user, backend='chat.backends.EmailOrUsernameModelBackend')
                messages.success(request, 'Cadastro realizado com sucesso! Você já está logado.')
                return redirect('index')
    else:
        form = UsernameSignUpForm()
        email_form = EmailSignUpForm()

    return render(request, 'register.html', {
        'form': form,
        'email_form': email_form
    })

@login_required
def profile_view(request):
    if request.method == 'POST':
        u_form = UserUpdateForm(request.POST, instance=request.user)
        p_form = ProfileUpdateForm(request.POST, request.FILES, instance=request.user.profile)
        if u_form.is_valid() and p_form.is_valid():
            u_form.save()
            p_form.save()
            messages.success(request, 'Seu perfil foi atualizado com sucesso!')
            return redirect('profile')
    else:
        u_form = UserUpdateForm(instance=request.user)
        p_form = ProfileUpdateForm(instance=request.user.profile)
    context = {
        'u_form': u_form,
        'p_form': p_form
    }
    return render(request, 'profile.html', context)

def credits_view(request):
    return render(request, 'credits.html')

@login_required
def clear_chat(request, room_slug):
    try:
        room = ChatRoom.objects.get(slug=room_slug)
    except ChatRoom.DoesNotExist:
        messages.error(request, "A sala que você tentou limpar não existe.")
        return redirect('index')

    messages_to_clear = ChatMessage.objects.filter(room_name=room.name)
    for message in messages_to_clear:
        message.deleted_by.add(request.user)
    messages.success(request, "A conversa foi limpa para você.")
    return redirect('chat:chat_room', room_slug=room.slug)

@login_required
def start_dm_view(request, username):
    try:
        other_user = User.objects.get(username=username)
    except User.DoesNotExist:
        messages.error(request, "Usuário não encontrado.")
        return redirect('index')

    if request.user == other_user:
        messages.warning(request, "Você não pode iniciar uma conversa consigo mesmo.")
        return redirect('index')

    # Use usernames directly, sorted, to create a consistent room identifier
    usernames = sorted([request.user.username, other_user.username])
    room_slug = '-'.join(usernames)
    
    return redirect('chat:chat_room', room_slug=room_slug)

@login_required
def delete_room_view(request, room_slug):
    try:
        room = ChatRoom.objects.get(slug=room_slug)
    except ChatRoom.DoesNotExist:
        messages.error(request, "Esta sala não existe.")
        return redirect('index')

    if request.user == room.creator:
        ChatMessage.objects.filter(room_name=room.name).delete()
        room.delete()
        messages.success(request, f"A sala '{room.name}' foi deletada com sucesso.")
    else:
        messages.error(request, "Você não tem permissão para deletar esta sala.")
    return redirect('index')

@login_required
def heartbeat_view(request):
    if request.method == 'POST':
        profile = Profile.objects.get(user=request.user)
        profile.last_seen = timezone.now()
        profile.save()
        return JsonResponse({'status': 'ok'})
    return JsonResponse({'status': 'bad request'}, status=400)