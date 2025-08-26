from django.db import migrations, models

def generate_unique_slugs(apps, schema_editor):
    ChatRoom = apps.get_model("chat", "ChatRoom")
    for room in ChatRoom.objects.all():
        if not room.slug:
            room.slug = f"room-{room.id}"
            room.save()

class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0015_alter_profile_avatar'),
    ]

    operations = [
        migrations.AddField(
            model_name='chatroom',
            name='slug',
            field=models.SlugField(blank=True, max_length=100, unique=True),
        ),
        migrations.RunPython(generate_unique_slugs),
    ]
