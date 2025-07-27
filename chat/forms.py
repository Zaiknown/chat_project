from django import forms
from django.contrib.auth.models import User
from django.contrib.auth.forms import UserCreationForm
from .models import Profile, ChatRoom

class CustomUserCreationForm(UserCreationForm):
    class Meta(UserCreationForm.Meta):
        model = User
        fields = UserCreationForm.Meta.fields + ('email',)

class UserUpdateForm(forms.ModelForm):
    email = forms.EmailField()

    class Meta:
        model = User
        fields = ['username', 'email']

class ProfileUpdateForm(forms.ModelForm):
    class Meta:
        model = Profile
        fields = ['avatar']

class RoomCreationForm(forms.ModelForm):
    class Meta:
        model = ChatRoom
        fields = ['name', 'password', 'user_limit']
        widgets = {
            'password': forms.PasswordInput(render_value=False, attrs={'placeholder': 'Deixe em branco para uma sala pública'}),
        }
        labels = {
            'name': 'Nome da Sala',
            'password': 'Senha (opcional)',
            'user_limit': 'Limite de Usuários'
        }

class RoomPasswordForm(forms.Form):
    password = forms.CharField(widget=forms.PasswordInput, label="Senha da Sala")