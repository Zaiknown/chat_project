from django.db import migrations, models

def generate_unique_slugs(apps, schema_editor):
    ChatRoom = apps.get_model("chat", "ChatRoom")
    for room in ChatRoom.objects.all():
        if not room.slug:
            room.slug = f"room-{room.id}"
            room.save()

class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0015_alter_profile_avatar'),  # ajuste conforme sua última migration
    ]

    operations = [
        migrations.AddField(
            model_name='chatroom',
            name='slug',
            field=models.SlugField(blank=True, null=True, max_length=100),
        ),
        migrations.RunPython(generate_unique_slugs),
    ]
