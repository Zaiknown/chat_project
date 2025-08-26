from django.db import migrations, models

class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0016_chatroom_slug'),
    ]

    operations = [
        migrations.AlterField(
            model_name='chatroom',
            name='slug',
            field=models.SlugField(max_length=100, unique=True),
        ),
    ]
