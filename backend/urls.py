from django.contrib import admin
from django.urls import path, include
from chat import views as chat_views
from django.contrib.auth import views as auth_views
from django.conf import settings # ADICIONE ESTA LINHA
from django.conf.urls.static import static # ADICIONE ESTA LINHA
from chat.forms import CustomAuthenticationForm

urlpatterns = [
    path('', chat_views.index_view, name='index'),
    path('admin/', admin.site.urls),
    path('register/', chat_views.register_view, name='register'),
    path('login/', auth_views.LoginView.as_view(template_name='login.html', authentication_form=CustomAuthenticationForm), name='login'),
    path('logout/', auth_views.LogoutView.as_view(), name='logout'),
    path('profile/', chat_views.profile_view, name='profile'),
    path('credits/', chat_views.credits_view, name='credits'),
    path('heartbeat/', chat_views.heartbeat_view, name='heartbeat'),
    path('chat/', include('chat.urls', namespace='chat')),
]

if settings.DEBUG is False:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)