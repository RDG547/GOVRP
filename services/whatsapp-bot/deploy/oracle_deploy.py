#!/usr/bin/python3 -I
"""Root-owned deployment entry point. It accepts only an approved main revision."""

import datetime as dt
import fcntl
import io
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
from dataclasses import dataclass
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


STATE = Path('/var/lib/govrp-whatsapp-deploy')
BOOTSTRAP = Path('/opt/govrp/services/whatsapp-bot')
ENV_FILE = BOOTSTRAP / '.env'
SWAP = STATE / 'build.swap'
REPO = 'https://github.com/RDG547/GOVRP.git'
APP = 'services/whatsapp-bot'
MAIN = 'refs/remotes/origin/main'
PROJECT = 'whatsapp-bot'
SERVICE = 'govrp-whatsapp'
VOLUME = 'whatsapp-bot_govrp_bot_session'
SHA = re.compile(r'[0-9a-f]{40}')


class DeployError(Exception):
    pass


@dataclass(frozen=True)
class Release:
    commit: str
    app: Path
    image: str
    image_id: str


def now():
    return dt.datetime.now(dt.timezone.utc)


def log(message):
    line = f'{now().isoformat(timespec="seconds")} {message}'
    with (STATE / 'deploy.log').open('a', encoding='utf-8') as file:
        file.write(line + '\n')
    try:
        print(line, flush=True)
    except BrokenPipeError:
        pass


def run(*args, capture=False, env=None, timeout=120):
    result = subprocess.run(args, check=True, capture_output=capture, env=env, timeout=timeout)
    return result.stdout if capture else None


def git(*args):
    return run('git', '--git-dir', str(STATE / 'repo.git'), *args, capture=True)


def approved_release(commit):
    if not (STATE / 'repo.git').is_dir():
        run('git', 'init', '--quiet', '--bare', str(STATE / 'repo.git'))
    # Compare only the bot and its workflow. Unrelated site commits may land while CI is running.
    git('fetch', '--quiet', '--no-tags', REPO, f'+refs/heads/main:{MAIN}')
    try:
        git('merge-base', '--is-ancestor', commit, MAIN)
        git('diff', '--quiet', commit, MAIN, '--', APP, '.github/workflows/whatsapp-bot.yml')
    except subprocess.CalledProcessError as exc:
        raise DeployError('Commit fora da main ou substituído por uma versão mais nova do bot.') from exc
    root = STATE / 'releases' / commit
    if not root.exists():
        root.parent.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=root.parent) as temp:
            with tarfile.open(fileobj=io.BytesIO(git('archive', commit, APP))) as archive:
                archive.extractall(temp, filter='data')
            Path(temp, APP).rename(root)
    return root


def image_id(image):
    return run('docker', 'image', 'inspect', '--format', '{{.Id}}', image, capture=True).decode().strip()


def container():
    ids = run('docker', 'ps', '-aq', '--filter', f'label=com.docker.compose.project={PROJECT}',
              '--filter', f'label=com.docker.compose.service={SERVICE}', capture=True).decode().split()
    if len(ids) != 1:
        raise DeployError('Esperava exatamente um contêiner de produção do bot.')
    data = json.loads(run('docker', 'inspect', ids[0], capture=True))[0]
    mounts = [(m['Type'], m.get('Name'), m['Destination'], m['RW']) for m in data['Mounts']]
    if mounts != [('volume', VOLUME, '/data', True)]:
        raise DeployError('O contêiner não usa exclusivamente o volume persistente esperado em /data.')
    return data


def previous_release(running):
    state_file = STATE / 'current.json'
    if state_file.exists():
        current = json.loads(state_file.read_text())
        commit = current['commit']
        app = STATE / 'releases' / commit
        if current['image_id'] != running['Image'] or not (app / 'docker-compose.yml').is_file():
            raise DeployError('O contêiner atual diverge da última versão registrada.')
    else:
        commit = run('git', '-C', str(BOOTSTRAP), 'rev-parse', 'HEAD', capture=True).decode().strip()
        app = BOOTSTRAP
    if not SHA.fullmatch(commit):
        raise DeployError('Não foi possível identificar a versão anterior.')
    rollback_image = f'govrp-whatsapp:rollback-{commit}'
    run('docker', 'tag', running['Image'], rollback_image)
    return Release(commit, app, rollback_image, running['Image'])


def compose(release, *args, capture=False):
    environment = {**os.environ, 'GOVRP_DEPLOY_IMAGE': release.image}
    return run('docker', 'compose', '--project-name', PROJECT, '--project-directory', str(release.app),
               '--env-file', '/dev/null', '-f', str(release.app / 'docker-compose.yml'),
               '-f', str(STATE / 'production.compose.yml'), *args, capture=capture, env=environment)


def validate_compose(release):
    config = json.loads(compose(release, 'config', '--no-env-resolution', '--format', 'json', capture=True))
    services = config['services']
    if set(services) != {SERVICE}:
        raise DeployError('O Compose de produção deve definir somente o serviço do bot.')
    service = services[SERVICE]
    mounts = service.get('volumes', [])
    if (len(mounts) != 1 or mounts[0].get('type') != 'volume' or
            mounts[0].get('source') != 'govrp_bot_session' or mounts[0].get('target') != '/data' or
            mounts[0].get('read_only')):
        raise DeployError('O Compose mudou a montagem da sessão do WhatsApp.')
    volume = config['volumes'].get('govrp_bot_session', {})
    if volume.get('name') != VOLUME or not volume.get('external') or service.get('image') != release.image:
        raise DeployError('O Compose não aponta para a imagem e o volume de produção esperados.')
    if any(service.get(key) for key in ('ports', 'privileged', 'devices', 'cap_add', 'volumes_from')) or any(
            service.get(key) == 'host' for key in ('network_mode', 'ipc', 'pid')):
        raise DeployError('O Compose contém portas publicadas ou acesso privilegiado ao host.')
    if set(service.get('environment', {})) & {'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'BOT_SESSION_DB'}:
        raise DeployError('O Compose tenta sobrescrever valores protegidos do arquivo .env.')


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def heartbeat():
    # Treat the file as data. Never source, print or pass the key in a process argument.
    values = dict(line.strip().split('=', 1) for line in ENV_FILE.read_text().splitlines()
                  if '=' in line and not line.lstrip().startswith('#'))
    url = urlsplit(values['SUPABASE_URL'])
    if url.scheme != 'https' or not re.fullmatch(r'[a-z0-9]+\.supabase\.co', url.netloc) or url.path not in ('', '/'):
        raise DeployError('URL do Supabase fora do formato esperado.')
    key = values['SUPABASE_SERVICE_ROLE_KEY']
    headers = {'apikey': key, 'Accept': 'application/json'}
    if not key.startswith('sb_secret_'):
        headers['Authorization'] = f'Bearer {key}'
    query = 'select=last_seen_at,connected,paired&id=eq.true'
    request = Request(f'https://{url.netloc}/rest/v1/whatsapp_bot_runtime?{query}', headers=headers)
    try:
        with build_opener(NoRedirect).open(request, timeout=6) as response:
            row, = json.load(response)
        seen = dt.datetime.fromisoformat(row['last_seen_at'])
        return seen, row['connected'] is True and row['paired'] is True
    except (URLError, TimeoutError, ValueError, TypeError, KeyError) as exc:
        raise DeployError('O sinal do bot no Supabase não pôde ser lido.') from exc


def wait_healthy(release, started, timeout=110):
    deadline = time.monotonic() + timeout
    previous = started
    consecutive = 0
    while time.monotonic() < deadline:
        current = container()
        if current['Image'] != release.image_id or not current['State']['Running'] or current['RestartCount']:
            raise DeployError('O contêiner esperado não iniciou de forma estável.')
        try:
            seen, ready = heartbeat()
        except DeployError:
            consecutive = 0
        else:
            if not ready:
                consecutive = 0
            elif seen > previous and now() - seen < dt.timedelta(seconds=45):
                previous = seen
                consecutive += 1
                if consecutive == 2:
                    log('Saúde confirmada: dois sinais recentes no Supabase e WhatsApp conectado e pareado.')
                    return
        time.sleep(5)
    raise DeployError('O bot não publicou dois sinais novos e pareados no prazo.')


def deploy_swap():
    available = next(int(line.split()[1]) for line in Path('/proc/meminfo').read_text().splitlines()
                     if line.startswith('MemAvailable:'))
    if available >= 1024 * 1024 or SWAP.exists():
        return False
    SWAP.touch(mode=0o600, exist_ok=False)
    try:
        run('fallocate', '-l', '1G', str(SWAP))
        run('mkswap', '--quiet', str(SWAP))
        run('swapon', str(SWAP))
    except (subprocess.SubprocessError, OSError):
        SWAP.unlink(missing_ok=True)
        raise
    return True


def build(commit, app):
    image = f'govrp-whatsapp:{commit}'
    swap_created = deploy_swap()
    try:
        run('docker', 'build', '--progress=plain', '--label', f'org.opencontainers.image.revision={commit}',
            '--tag', image, str(app), timeout=1500)
    finally:
        if swap_created:
            run('swapoff', str(SWAP))
            SWAP.unlink()
    return Release(commit, app, image, image_id(image))


def start(release):
    started = now()
    compose(release, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--force-recreate', SERVICE)
    wait_healthy(release, started)


def record(release):
    pending = STATE / 'current.json.tmp'
    pending.write_text(json.dumps({'commit': release.commit, 'image_id': release.image_id,
                                   'deployed_at': now().isoformat(timespec='seconds')}) + '\n')
    pending.replace(STATE / 'current.json')


def switch(candidate, previous):
    validate_compose(candidate)
    validate_compose(previous)
    log(f'Implantando {candidate.commit}; versão de retorno {previous.commit}.')
    try:
        start(candidate)
        record(candidate)
    except Exception as failure:
        log(f'Nova versão rejeitada: {failure}. Iniciando um rollback para {previous.commit}.')
        try:
            start(previous)
        except Exception as rollback_failure:
            raise DeployError(f'Rollback falhou: {rollback_failure}. Intervenção necessária.') from rollback_failure
        log(f'Rollback verificado: {previous.commit}.')
        raise DeployError('Deploy reprovado; a versão anterior foi restaurada e verificada.') from failure


def interrupt(signum, _frame):
    raise DeployError(f'Implantação interrompida pelo sinal {signum}.')


def main():
    request = sys.stdin.readline(80).strip()
    if request != 'verify' and not SHA.fullmatch(request):
        raise DeployError('Comando de implantação inválido.')
    if ENV_FILE.stat().st_uid != 0 or ENV_FILE.stat().st_mode & 0o077:
        raise DeployError('O arquivo .env deve pertencer ao root e ter acesso privado.')
    with (STATE / 'deploy.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise DeployError('Já existe outra implantação na VPS.') from exc
        running = container()
        seen, ready = heartbeat()
        if not running['State']['Running'] or not ready or now() - seen > dt.timedelta(seconds=70):
            raise DeployError('O bot atual não está saudável e pareado. Verifique-o antes de trocar a versão.')
        if request == 'verify':
            log('Acesso de implantação verificado; contêiner, volume, Supabase e WhatsApp saudáveis.')
            return
        log(f'Deploy solicitado para {request}.')
        app = approved_release(request)
        previous = previous_release(running)
        if (STATE / 'current.json').exists() and previous.commit == request:
            log(f'O commit {request} já está executando e saudável.')
            return
        candidate = build(request, app)
        # Main can change during compilation. Check again before touching production.
        approved_release(request)
        if container()['Image'] != previous.image_id:
            raise DeployError('A imagem em produção mudou durante a compilação.')
        switch(candidate, previous)
        log(f'Deploy confirmado: {request}.')


if __name__ == '__main__':
    for sig in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, interrupt)
    try:
        main()
    except (DeployError, subprocess.SubprocessError, OSError, ValueError, KeyError) as exc:
        log(f'FALHA: {exc}')
        sys.exit(1)
