# Firefox dist for the Gecko sidecar image

The Docker image copies `firefox-dist.tar.gz` and unpacks it to `/opt/speculum/firefox`.
It is a **published** `dist/bin` of the Speculum Firefox fork — `mach` does not run
in the image build. The tar exists because Docker Desktop on Windows cannot COPY
the raw `dist/bin` tree (symlinks / Unix helper names).

Pack from the checkout (reuses the lab binary):

```
bash gecko-engine/scripts/pack-gecko-dist.sh
```

Without `firefox-dist.tar.gz`, `docker build` fails. Packed files are gitignored.
Dockup builds the image on the machine that ran the pack, then pushes the **image**.
