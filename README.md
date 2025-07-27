# 🚀 Chat em Tempo Real com Django Channels

Este é um projeto de aplicação de chat em tempo real robusta, desenvolvida com Django e Django Channels, permitindo comunicação instantânea entre usuários em diversas salas, com funcionalidades avançadas e uma interface de usuário rica.

## ✨ Funcionalidades Principais

* **Autenticação Completa:** Sistema de cadastro, login e logout de usuários.
* **Perfis de Usuário:** Página de perfil personalizada com edição de dados e **upload de avatares**.
* **Lobby de Salas:**
    * Listagem dinâmica de salas de chat disponíveis.
    * **Contagem de usuários online** em tempo real para cada sala.
    * Criação de novas salas com opções de **senha** e **limite de usuários**.
* **Chat em Tempo Real:**
    * Comunicação instantânea entre usuários via **WebSockets** (Django Channels).
    * Mensagens salvas e **histórico carregado** ao entrar na sala.
    * Exibição de **avatares** e **timestamps** para cada mensagem.
    * **Indicador de "está digitando..."** em tempo real.
    * Lista de usuários na sala mostrando status **"Online"** ou **"Visto por último"**.
    * **Notificações de entrada e saída** de usuários na sala.
* **Experiência de Usuário (UX):**
    * Seletor de **tema claro/escuro**.
    * Interface totalmente personalizada e responsiva, desenvolvida com CSS e JavaScript puros (sem frameworks como Bootstrap).
* **Arquitetura Robusta:** Backend rodando com um servidor ASGI (Daphne) e um "channel layer" (Redis/Memurai) para comunicação de alta performance.

## 🛠️ Tecnologias Utilizadas

* **Backend:**
    * [Python](https://www.python.org/)
    * [Django](https://www.djangoproject.com/) (Framework Web)
    * [Django Channels](https://channels.readthedocs.io/) (WebSockets e Comunicação em Tempo Real)
    * [Redis](https://redis.io/) (Message Broker para Channels - utilizado via Memurai no Windows)
* **Frontend:**
    * HTML5
    * CSS3
    * JavaScript (Puro)
* **Banco de Dados:**
    * SQLite (para desenvolvimento - pode ser facilmente migrado para PostgreSQL/MySQL em produção)

## 🚀 Como Rodar o Projeto Localmente

Siga os passos abaixo para configurar e executar o projeto em sua máquina local.

### Pré-requisitos

* [Python 3.x](https://www.python.org/downloads/)
* [pip](https://pip.pypa.io/en/stable/installation/) (gerenciador de pacotes Python)
* [Git](https://git-scm.com/downloads/)
* **Redis/Memurai:**
    * Para Windows: Instale [Memurai](https://www.memurai.com/documentation/installation) e certifique-se de que esteja rodando.
    * Para macOS/Linux: Instale [Redis](https://redis.io/download/) (ex: `brew install redis` ou `sudo apt-get install redis-server`) e inicie o serviço.

### Instalação

1.  **Clone o repositório:**
    ```bash
    git clone [https://github.com/SeuUsuario/SeuRepositorio.git](https://github.com/SeuUsuario/SeuRepositorio.git)
    cd SeuRepositorio
    ```
    (Substitua `SeuUsuario` e `SeuRepositorio` pelos seus dados reais.)

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

4.  **Configurações do Django:**
    * Certifique-se de que o Redis/Memurai está rodando.
    * (Opcional) Crie um arquivo `.env` na raiz do projeto para variáveis de ambiente, se você estiver usando um.

5.  **Execute as migrações do banco de dados:**
    ```bash
    python manage.py migrate
    ```

6.  **Crie um superusuário (opcional, para acessar o admin do Django):**
    ```bash
    python manage.py createsuperuser
    ```

7.  **Inicie o servidor de desenvolvimento do Django Channels:**
    ```bash
    daphne -b 0.0.0.0 -p 8000 SeuProjeto.asgi:application
    # Ou, se preferir usar o runserver do Django (que também funciona com Channels):
    # python manage.py runserver
    ```
    (Substitua `SeuProjeto` pelo nome da sua pasta raiz do projeto Django, onde está o `settings.py` e `asgi.py`.)

8.  **Acesse a aplicação:**
    Abra seu navegador e vá para `http://127.0.0.1:8000/`.

## 📄 Licença

Este projeto está licenciado sob a Licença MIT. Veja o arquivo [LICENSE](LICENSE) para mais detalhes.

Lembre-se de substituir `SeuUsuario` e `SeuRepositorio` pelos seus dados reais no GitHub.

Com um `.gitignore` bem configurado e um `README.md` detalhado como este, seu projeto estará muito mais profissional e fácil de ser compreendido e utilizado por outras pessoas! Se tiver mais alguma dúvida, é só perguntar!
http://googleusercontent.com/memory_tool_content/0