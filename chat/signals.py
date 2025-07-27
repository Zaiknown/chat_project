from django.db.models.signals import post_save
from django.contrib.auth.models import User
from django.dispatch import receiver
from .models import Profile
from django.core.mail import send_mail

@receiver(post_save, sender=User)
def create_or_update_user_profile(sender, instance, created, **kwargs):
    if created:
        Profile.objects.create(user=instance)
        
        # Envia o email de boas-vindas
        subject = 'Bem-vindo ao Chat em Tempo Real!'
        message = f'Olá, {instance.username}!\n\nSua conta foi criada com sucesso. Aproveite nossa plataforma.'
        from_email = 'seuemaildeenvio@exemplo.com' # Mude para um email seu
        recipient_list = [instance.email]

        if instance.email: # Só envia se o email for fornecido
            send_mail(subject, message, from_email, recipient_list, fail_silently=False)
    
    # Garante que o perfil seja salvo sempre que o usuário for salvo
    instance.profile.save()