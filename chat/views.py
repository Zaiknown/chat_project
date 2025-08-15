from django.shortcuts import render, redirect
from django.contrib.auth.decorators import login_required
from django.contrib.auth import login
from django.contrib import messages
from django.core.cache import cache
from django.db.models import Q
from .models import ChatMessage, Profile, User, ChatRoom
from .forms import UserUpdateForm, ProfileUpdateForm, RoomCreationForm, RoomPasswordForm, CustomUserCreationForm
from django.http import JsonResponse
from django.utils import timezone

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
            return redirect('chat:chat-room', room_name=room.name)

    public_rooms = ChatRoom.objects.all().order_by('-created_at')
    for room in public_rooms:
        safe_name = ''.join(e for e in room.name if e.isalnum() or e in ['-', '_']).lower()
        room.user_count = cache.get(f'chat_{safe_name}', 0)
        
    private_chats = []
    if request.user.is_authenticated:
        dm_room_names = ChatMessage.objects.filter(
            Q(author=request.user) | Q(room_name__contains=request.user.username)
        ).filter(
            room_name__contains='-'
        ).values_list('room_name', flat=True).distinct()

        for room_name in dm_room_names:
            participants = room_name.split('-')
            other_username = participants[0] if participants[1] == request.user.username else participants[1]
            try:
                other_user_profile = Profile.objects.get(user__username=other_username)
                private_chats.append(other_user_profile)
            except Profile.DoesNotExist:
                continue

    context = {
        'public_rooms': public_rooms,
        'private_chats': private_chats,
        'form': form
    }
    return render(request, 'index.html', context)

@login_required
def chat_room_view(request, room_name):
    is_dm = '-' in room_name
    other_user_profile = None
    room = None

    if is_dm:
        participants = room_name.split('-')
        if request.user.username not in participants:
            messages.error(request, "Você não tem permissão para entrar nesta conversa.")
            return redirect('index')
        
        other_username = participants[0] if participants[1] == request.user.username else participants[1]
        try:
            other_user_profile = Profile.objects.select_related('user').get(user__username=other_username)
        except Profile.DoesNotExist:
            messages.error(request, "Usuário da conversa não encontrado.")
            return redirect('index')
    else:
        try:
            room = ChatRoom.objects.get(name=room_name)
        except ChatRoom.DoesNotExist:
            messages.error(request, "A sala que você tentou acessar não existe.")
            return redirect('index')

    if room and room.password:
        if room.name not in request.session.get('authorized_rooms', []):
            if request.method == 'POST':
                form = RoomPasswordForm(request.POST)
                if form.is_valid() and form.cleaned_data['password'] == room.password:
                    authorized_rooms = request.session.get('authorized_rooms', [])
                    authorized_rooms.append(room.name)
                    request.session['authorized_rooms'] = authorized_rooms
                    return redirect('chat:chat-room', room_name=room.name)
                else:
                    messages.error(request, "Senha incorreta!")
            return render(request, 'password_prompt.html', {'room': room, 'form': RoomPasswordForm()})
        else:
            authorized_rooms = request.session.get('authorized_rooms', [])
            if room.name in authorized_rooms:
                authorized_rooms.remove(room.name)
                request.session['authorized_rooms'] = authorized_rooms
                request.session.modified = True

    chat_messages_qs = ChatMessage.objects.filter(room_name=room_name).select_related('author__profile', 'parent__author').exclude(deleted_by=request.user).order_by('timestamp')[:50]
    
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
            'timestamp': message.timestamp.strftime('%H:%M'),
            'avatar_url': message.author.profile.avatar.url,
            'is_sent_by_user': message.author == request.user,
            'parent': parent_info,
        })
    
    display_name = "Chat Privado" if is_dm else room_name

    context = {
        'room_name': room_name,
        'display_name': display_name,
        'chat_messages': messages_list,
        'is_dm': is_dm,
        'other_user_profile': other_user_profile,
        'room': room,
        'is_admin': room.creator == request.user or request.user in room.admins.all() if room else False
    }
    return render(request, 'chat_room.html', context)

@login_required
def room_status_view(request, room_name):
    if '-' in room_name:
        return JsonResponse({'is_muted': False})
    try:
        room = ChatRoom.objects.get(name=room_name)
        return JsonResponse({'is_muted': room.is_muted})
    except ChatRoom.DoesNotExist:
        return JsonResponse({'error': 'Sala não encontrada'}, status=404)

def register_view(request):
    if request.user.is_authenticated:
        return redirect('index')
    if request.method == 'POST':
        form = CustomUserCreationForm(request.POST)
        if form.is_valid():
            user = form.save()
            login(request, user)
            messages.success(request, 'Cadastro realizado com sucesso! Você já está logado.')
            return redirect('index')
    else:
        form = CustomUserCreationForm()
    return render(request, 'register.html', {'form': form})

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
def start_dm_view(request, username):
    try:
        other_user = User.objects.get(username=username)
    except User.DoesNotExist:
        messages.error(request, "Usuário não encontrado.")
        return redirect('index')

    if request.user == other_user:
        messages.warning(request, "Você não pode iniciar uma conversa consigo mesmo.")
        return redirect('index')

    usernames = sorted([request.user.username, other_user.username])
    room_name = '-'.join(usernames)
    return redirect('chat:chat-room', room_name=room_name)

@login_required
def delete_room_view(request, room_name):
    try:
        room = ChatRoom.objects.get(name=room_name)
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
