# ARQUIVO: chat/urls.py

from django.urls import path, re_path
from . import views

app_name = 'chat'

urlpatterns = [
    path('dm/<str:username>/', views.start_dm_view, name='start-dm'),
    path('heartbeat/', views.heartbeat_view, name='heartbeat'),
    re_path(r'^join/(?P<room_slug>[-a-zA-Z0-9_.]+)/$', views.join_room, name='join_room'),
    re_path(r'^leave/(?P<room_slug>[-a-zA-Z0-9_.]+)/$', views.leave_room, name='leave_room'),
    re_path(r'^(?P<room_slug>[-a-zA-Z0-9_.]+)/delete/$', views.delete_room_view, name='delete-room'),
    re_path(r'^clear_chat/(?P<room_slug>[-a-zA-Z0-9_.]+)/$', views.clear_chat, name='clear_chat'),
    re_path(r'^(?P<room_slug>[-a-zA-Z0-9_.]+)/$', views.chat_room_view, name='chat_room'),
]