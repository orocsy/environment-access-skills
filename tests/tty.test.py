"""Exercise a real POSIX terminal, not the --stdin automation path."""
import os, sys, tempfile, subprocess, json, select, time
from pathlib import Path
if os.name != 'posix':
    print('TTY test skipped: POSIX required')
    raise SystemExit(0)
import pty
script = Path(__file__).resolve().parents[1] / 'skills/secure-key-handoff/scripts/handoff.mjs'
with tempfile.TemporaryDirectory(prefix='handoff-tty-') as folder:
    base = Path(folder)
    created = subprocess.run(['node', str(script), 'prepare', '--platform', 'generic', '--environment', 'test', '--label', 'TTY demo', '--private-dir', str(base/'private'), '--out', str(base/'delivery')], capture_output=True, text=True, check=True)
    info = json.loads(created.stdout)
    master, slave = pty.openpty()
    proc = subprocess.Popen(['node', str(script), 'seal', '--request', str(base/'delivery/request.json'), '--out', str(base/'encrypted.json')], stdin=slave, stdout=slave, stderr=slave)
    os.close(slave)
    seen = b''
    deadline = time.monotonic()+10
    while b'press Enter:' not in seen:
        assert time.monotonic()<deadline, 'No hidden prompt'
        if select.select([master],[],[],0.2)[0]: seen += os.read(master,4096)
    fake = b'DEMO_TTY_SECRET_ONLY'
    os.write(master, fake+b'\r')
    assert proc.wait(timeout=10)==0
    try:
        while select.select([master],[],[],0.1)[0]:
            chunk = os.read(master,4096)
            if not chunk: break
            seen += chunk
    except OSError: pass
    os.close(master)
    assert fake not in seen, 'Secret echoed to terminal'
    subprocess.run(['node',str(script),'receive','--request',str(base/'private'/f"{info['requestId']}.request.json"),'--key',info['privateKey'],'--input',str(base/'encrypted.json'),'--out',str(base/'private/value.secret')],capture_output=True,check=True)
    assert (base/'private/value.secret').read_bytes()==fake
print('PASS: real terminal input is hidden and decrypted fake value matches')
