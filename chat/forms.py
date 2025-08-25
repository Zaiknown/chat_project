from django import forms
from django.contrib.auth.models import User
from django.contrib.auth.forms import UserCreationForm, AuthenticationForm
from .models import Profile, ChatRoom

class UsernameSignUpForm(UserCreationForm):
    class Meta(UserCreationForm.Meta):
        model = User
        fields = ('username',)

class EmailSignUpForm(UserCreationForm):
    email = forms.EmailField(required=True)

    class Meta(UserCreationForm.Meta):
        model = User
        fields = ('email',)

    def save(self, commit=True):
        user = super().save(commit=False)
        user.username = user.email.split('@')[0]
        if commit:
            user.save()
        return user

class CustomAuthenticationForm(AuthenticationForm):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['username'].label = 'Nome de Usuário ou Email'

class UserUpdateForm(forms.ModelForm):
    email = forms.EmailField(required=False)

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