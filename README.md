# 🚀 Chat em Tempo Real com Django Channels

Um projeto de aplicação de chat em tempo real robusto e completo, desenvolvido com Django e Django Channels, permitindo comunicação instantânea entre usuários em diversas salas, com funcionalidades avançadas e uma interface de usuário rica.

✨ **[Veja o Projeto Online (https://chat-project-tirc.onrender.com/)]** ✨

---

## ✨ Funcionalidades Principais

* **Autenticação Completa:** Sistema de cadastro (com nome de usuário ou e-mail), login e logout de usuários.
* **Perfis de Usuário:** Página de perfil personalizada com edição de dados e **upload de avatares**.
* **Lobby de Salas:**
    * Listagem dinâmica de salas de chat públicas.
    * Criação de novas salas com opções de **senha** e **limite de usuários**.
    * Aba para conversas privadas (mensagens diretas).
* **Chat em Tempo Real:**
    * Comunicação instantânea via **WebSockets** (Django Channels).
    * Mensagens salvas e **histórico carregado** ao entrar na sala.
    * Exibição de **avatares** e **timestamps** para cada mensagem.
    * **Indicador de "está digitando..."** em tempo real.
    * Lista de usuários na sala mostrando status **"Online"** ou **"Visto por último"**.
    * Notificações de entrada e saída de usuários.
    * **Mensagens Diretas (DM)** entre usuários.
* **Experiência de Usuário (UX):**
    * Seletor de **tema claro/escuro**.
    * Interface totalmente personalizada e responsiva, desenvolvida com CSS e JavaScript puros (sem frameworks como Bootstrap).
* **Arquitetura de Produção:** Backend rodando com um servidor ASGI (Daphne), um servidor WSGI (Gunicorn) e um "channel layer" (Redis) para comunicação de alta performance.

## 🛠️ Tecnologias Utilizadas

* **Backend:**
    * [Python](https://www.python.org/)
    * [Django](https://www.djangoproject.com/) (Framework Web)
    * [Django Channels](https://channels.readthedocs.io/) (WebSockets e Comunicação Assíncrona)
    * [Daphne](https://github.com/django/daphne) (Servidor ASGI)
    * [Gunicorn](https://gunicorn.org/) (Servidor WSGI)
    * [Redis](https://redis.io/) (Message Broker para Channels)
* **Frontend:**
    * HTML5
    * CSS3
    * JavaScript (Puro)
* **Banco de Dados:**
    * PostgreSQL (em produção)
    * SQLite (para desenvolvimento)
* **Implantação (Deployment):**
    * [Render](https://render.com/) (Web Service, Background Worker, Redis e Disco Persistente)
    * [WhiteNoise](http://whitenoise.evans.io/) (Serviço de Arquivos Estáticos)

## 🚀 Como Rodar o Projeto Localmente

### Pré-requisitos

* [Python 3.10+](https://www.python.org/downloads/)
* [Git](https://git-scm.com/downloads/)
* **Redis:** É necessário ter uma instância do Redis rodando localmente.
    * **Para macOS/Linux (via Homebrew/APT):**
        ```bash
        brew install redis  # ou sudo apt-get install redis-server
        redis-server
        ```
    * **Para Windows:** A maneira mais fácil é usando o [WSL](https://learn.microsoft.com/pt-br/windows/wsl/install) ou instalando o [Memurai](https://www.memurai.com/documentation/installation).

### Instalação

1.  **Clone o repositório:**
    ```bash
    git clone [https://github.com/Zaiknown/chat_project]
    cd chat_project
    ```

2.  **Crie e ative um ambiente virtual:**
    ```bash
    python -m venv venv
    # No Windows:
    .\venv\Scripts\activate
    # No macOS/Linux:
    source venv/bin/activate
    ```

3.  **Instale as dependências:**
    ```bash
    pip install -r requirements.txt
    ```

4.  **Crie um arquivo `.env`:**
    Na raiz do projeto (mesma pasta do `manage.py`), crie um arquivo chamado `.env` para as variáveis de ambiente.
    ```env
    SECRET_KEY=sua_chave_secreta_super_segura_aqui
    DEBUG=True
    ```

5.  **Execute as migrações do banco de dados:**
    ```bash
    python manage.py migrate
    ```

6.  **Crie um superusuário (opcional):**
    ```bash
    python manage.py createsuperuser
    ```

7.  **Inicie o servidor de desenvolvimento:**
    O `runserver` do Django já é suficiente para rodar o Channels localmente com o modo `DEBUG` ativado.
    ```bash
    python manage.py runserver
    ```

8.  **Acesse a aplicação:**
    Abra seu navegador e vá para `http://127.0.0.1:8000/`.

## 📄 Licença

Este projeto está licenciado sob a Licença MIT. Veja o arquivo [LICENSE](LICENSE) para mais detalhes.