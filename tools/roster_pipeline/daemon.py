"""Detach a command into its own session. macOS has no setsid."""
import os, sys
cmd = sys.argv[1:]
if os.fork(): sys.exit(0)
os.setsid()
if os.fork(): os._exit(0)
os.dup2(os.open(os.devnull, os.O_RDONLY), 0)
out = os.open('daemon_out.txt', os.O_WRONLY | os.O_CREAT | os.O_TRUNC)
os.dup2(out, 1); os.dup2(out, 2)
os.execvp(cmd[0], cmd)
