# Generated by Django 5.2.4 on 2025-07-25 18:28

import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0003_alter_profile_avatar'),
    ]

    operations = [
        migrations.AddField(
            model_name='profile',
            name='last_seen',
            field=models.DateTimeField(default=django.utils.timezone.now),
        ),
    ]
