from pathlib import Path
from decouple import config
import os
import dj_database_url  # ADICIONADO: Para configurar o banco de dados do Render
import re # ADICIONADO: Para extrair dados da URL do Redis

BASE_DIR = Path(__file__).resolve().parent.parent

# MODIFICADO: A SECRET_KEY agora é carregada de uma variável de ambiente para segurança.
SECRET_KEY = config('SECRET_KEY')

# MODIFICADO: O modo DEBUG é desativado em produção por padrão para segurança.
DEBUG = config('DEBUG', default=False, cast=bool)

# MODIFICADO: Configura os hosts permitidos dinamicamente a partir do Render.
ALLOWED_HOSTS = []
RENDER_EXTERNAL_HOSTNAME = config('RENDER_EXTERNAL_HOSTNAME', default=None)
if RENDER_EXTERNAL_HOSTNAME:
    ALLOWED_HOSTS.append(RENDER_EXTERNAL_HOSTNAME)

# ADICIONE ESTA LINHA ABAIXO
CSRF_TRUSTED_ORIGINS = [f'https://{RENDER_EXTERNAL_HOSTNAME}'] if RENDER_EXTERNAL_HOSTNAME else []

INSTALLED_APPS = [
    'channels',
    'daphne',
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'chat',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',  # ADICIONADO: Para servir arquivos estáticos em produção.
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'backend.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'backend.wsgi.application'

# MODIFICADO: Configuração do banco de dados para usar o PostgreSQL do Render em produção.
DATABASES = {
    'default': dj_database_url.config(
        default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
        conn_max_age=600
    )
}

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

AUTHENTICATION_BACKENDS = [
    'chat.backends.EmailOrUsernameModelBackend',
    'django.contrib.auth.backends.ModelBackend',
]

LANGUAGE_CODE = 'pt-br'
TIME_ZONE = 'America/Sao_Paulo'
USE_I18N = True
USE_TZ = True

# MODIFICADO: Configuração de arquivos estáticos para produção.
STATIC_URL = 'static/'
STATIC_ROOT = os.path.join(BASE_DIR, 'staticfiles')
STATICFILES_DIRS = [BASE_DIR / 'static']

# ADICIONADO: Armazenamento para WhiteNoise.
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'

MEDIA_URL = '/media/'
# MODIFICADO: O MEDIA_ROOT será configurado via variável de ambiente no Render.
MEDIA_ROOT = config('MEDIA_ROOT', default=os.path.join(BASE_DIR, 'media'))

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

ASGI_APPLICATION = 'backend.asgi.application'

# MODIFICADO: Configuração do Channel Layer para usar o Redis do Render em produção.
REDIS_URL = config('REDIS_URL', default='redis://127.0.0.1:6379')
# Extrai host e porta da URL do Redis
match = re.match(r'redis:\/\/([^:]+):(\d+)', REDIS_URL)
redis_host, redis_port = match.groups() if match else ('127.0.0.1', 6379)


CHANNEL_LAYERS = {
    'default': {
        'BACKEND': 'channels_redis.core.RedisChannelLayer',
        'CONFIG': {
            "hosts": [(redis_host, int(redis_port))],
        },
    },
}

LOGIN_URL = 'login'
LOGIN_REDIRECT_URL = 'index'
LOGOUT_REDIRECT_URL = 'index'

# Mantido como está, será configurado via variáveis de ambiente.
EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
EMAIL_HOST = 'smtp.gmail.com'
EMAIL_PORT = 587
EMAIL_USE_TLS = True
EMAIL_HOST_USER = config('EMAIL_HOST_USER', default='')
EMAIL_HOST_PASSWORD = config('EMAIL_HOST_PASSWORD', default='')