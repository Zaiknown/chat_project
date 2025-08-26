from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone
from django.utils.text import slugify

from cloudinary.models import CloudinaryField

class ChatMessage(models.Model):
    author = models.ForeignKey(User, on_delete=models.CASCADE, related_name='chat_messages')
    room_name = models.CharField(max_length=255)
    content = models.TextField()
    timestamp = models.DateTimeField(auto_now_add=True)
    parent = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True, related_name='replies')
    deleted_by = models.ManyToManyField(User, related_name='deleted_messages', blank=True)
    is_deleted_for_everyone = models.BooleanField(default=False)
    deleted_by_admin = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='admin_deleted_messages')

    def __str__(self):
        return f'Message from {self.author.username} in {self.room_name}'

class Profile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    avatar = CloudinaryField(
        'avatar',
        # SUA URL FOI ADICIONADA AQUI
        default='https://res.cloudinary.com/dtrfgop8f/image/upload/v1756166420/vdu6rwcppbq8zvzddkdw.jpg',
        folder='avatars',
        use_filename=True,
        unique_filename=False,
    )
    last_seen = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return f'Perfil de {self.user.username}'

class ChatRoom(models.Model):
    name = models.CharField(max_length=100, unique=True)
    # ADICIONE O CAMPO SLUG ABAIXO
    slug = models.SlugField(unique=True, max_length=100, blank=True)
    creator = models.ForeignKey(User, on_delete=models.CASCADE, related_name='created_rooms')
    created_at = models.DateTimeField(auto_now_add=True)
    password = models.CharField(max_length=50, blank=True, null=True)
    user_limit = models.IntegerField(default=10)
    is_muted = models.BooleanField(default=False)
    admins = models.ManyToManyField(User, related_name='admin_of_rooms', blank=True)

    # ADICIONE ESTE MÉTODO SAVE
    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name

class ChatRoomBan(models.Model):
    room = models.ForeignKey(ChatRoom, on_delete=models.CASCADE)
    banned_user = models.ForeignKey(User, on_delete=models.CASCADE)
    banned_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('room', 'banned_user')

class ChatRoomMute(models.Model):
    room = models.ForeignKey(ChatRoom, on_delete=models.CASCADE)
    muted_user = models.ForeignKey(User, on_delete=models.CASCADE)
    muted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('room', 'muted_user')