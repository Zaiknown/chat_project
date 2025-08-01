from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone

class ChatMessage(models.Model):
    author = models.ForeignKey(User, on_delete=models.CASCADE, related_name='chat_messages')
    room_name = models.CharField(max_length=255)
    content = models.TextField()
    timestamp = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'Message from {self.author.username} in {self.room_name}'

class Profile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    avatar = models.ImageField(default='avatars/default.jpg', upload_to='avatars/')
    last_seen = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return f'Perfil de {self.user.username}'

class ChatRoom(models.Model):
    name = models.CharField(max_length=100, unique=True)
    creator = models.ForeignKey(User, on_delete=models.CASCADE, related_name='created_rooms')
    created_at = models.DateTimeField(auto_now_add=True)
    password = models.CharField(max_length=50, blank=True, null=True)
    user_limit = models.IntegerField(default=10)
    is_muted = models.BooleanField(default=False)
    
    # ALTERADO: Suporte para múltiplos administradores
    admins = models.ManyToManyField(User, related_name='admin_of_rooms', blank=True)
    
    def __str__(self):
        return self.name

class ChatRoomBan(models.Model):
    room = models.ForeignKey(ChatRoom, on_delete=models.CASCADE)
    banned_user = models.ForeignKey(User, on_delete=models.CASCADE)
    banned_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('room', 'banned_user')