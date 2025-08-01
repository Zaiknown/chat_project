# Generated by Django 5.2.4 on 2025-07-27 19:46

from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0007_alter_chatroom_creator_alter_chatroom_user_limit'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.RemoveField(
            model_name='chatroom',
            name='admin_user',
        ),
        migrations.AddField(
            model_name='chatroom',
            name='admins',
            field=models.ManyToManyField(blank=True, related_name='admin_of_rooms', to=settings.AUTH_USER_MODEL),
        ),
    ]
