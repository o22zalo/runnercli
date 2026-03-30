# runnerCLI

Bo CLI rieng de thao tac voi Cloudflare Tunnel, Tailscale ACL, va patch file `.env`.

Package nay cung cap 4 command:

- `runnerCLI`
- `runnerCLI-createtunnel`
- `runnerCLI-tailscale`
- `runnerCLI-patch-env`

## Cai dat bang npm link

### Cach 1: dung CLI global tu workspace nay

1. Mo terminal tai thu muc [`.runnerCLI`](./).
2. Chay:

```powershell
npm link
```

Sau lenh nay, 4 command o tren se co san tren may.

### Cach 2: link vao mot project khac

1. Tai [`.runnerCLI`](./), chay:

```powershell
npm link
```

2. Sang project dich, chay:

```powershell
npm link runnercli
```

Khi do:

- package duoc symlink vao `node_modules`
- bin duoc expose trong `node_modules/.bin`
- co the goi bang `npx runnerCLI ...` hoac dung trong `package.json scripts`

### Go bo link

Tai project dang link:

```powershell
npm unlink runnercli
```

Go bo link global:

```powershell
npm unlink -g runnercli
```

## Yeu cau chay

- Node.js de chay cac script CommonJS.
- Neu dung `runnerCLI-createtunnel`, can cai `cloudflared` va da login truoc:

```powershell
cloudflared tunnel login
```

- Neu dung `runnerCLI-tailscale`, can co OAuth client credentials cua Tailscale.

## Tong quan command

| Command | Tac dung | Dau vao chinh | Dau ra chinh |
| --- | --- | --- | --- |
| `runnerCLI` | Menu tong hop / selector | selector so hoac alias + arg cua command con | In menu hoac chuyen tiep sang command duoc chon |
| `runnerCLI-createtunnel` | Tao 1 tunnel va nhieu DNS routes | env `CLOUDFLARED_*`, `SSH_PORT`, `--yes` | `cloudflared-config.yml`, `cloudflared-credentials.json`, log command |
| `runnerCLI-tailscale` | Update ACL qua Tailscale API | OAuth env, `--tailnet`, `--body-file`, `--dry-run` | API response summary va ma status |
| `runnerCLI-patch-env` | Patch gia tri `*_BASE64` trong `.env` | duong dan `.env`, comment `# Path: ...`, `--dry-run` | Ghi de file `.env` hoac chi in summary neu dry-run |

## 1. runnerCLI

### Tac dung

- Hien thi menu tuong tac neu khong truyen doi so.
- Cho phep goi nhanh command con bang selector so hoac alias.

### Cu phap

```powershell
runnerCLI
runnerCLI <selector> [args...]
```

### Selector hop le

- `1`
- `createtunnel`
- `create-tunnel`
- `tunnel`
- `runnerCLI-createtunnel`
- `2`
- `tailscale`
- `acl`
- `access-controls`
- `runnerCLI-tailscale`
- `3`
- `patch-env`
- `patchenv`
- `env-patch`
- `runnerCLI-patch-env`

### Dau vao

- `selector`: xac dinh command can chay.
- `args...`: duoc forward nguyen cho command con.

### Dau ra

- Neu khong co doi so: in menu va hoi lua chon.
- Neu co selector hop le: in ten command da chon roi chay command do.
- Neu selector khong hop le: in loi va thoat voi exit code `1`.

### Vi du

```powershell
runnerCLI
runnerCLI 1 --yes
runnerCLI 2 --dry-run
runnerCLI 3 .env --dry-run
```

## 2. runnerCLI-createtunnel

### Tac dung

- Tao Cloudflare Tunnel bang `cloudflared tunnel create`.
- Tao nhieu DNS routes bang `cloudflared tunnel route dns`.
- Tu tim credential `.json` sau khi tao tunnel.
- Sinh file `cloudflared-config.yml`.
- Sinh file `cloudflared-credentials.json` co them metadata de luu tru/deploy lai.

### Cu phap

```powershell
runnerCLI-createtunnel [--yes]
```

### Doi so dong lenh

| Doi so | Bat buoc | Tac dung |
| --- | --- | --- |
| `--yes` / `-y` | Khong | Bo qua buoc xac nhan truoc khi tao tunnel va DNS |
| `--help` / `-h` | Khong | In huong dan su dung |

### Bien moi truong dau vao

#### Bat buoc

| Bien | Bat buoc | Mo ta |
| --- | --- | --- |
| `CLOUDFLARED_TUNNEL_NAME` | Co, neu khong dung prefix | Ten tunnel uu tien cao nhat |
| `CLOUDFLARED_TUNNEL_NAME_00`, `CLOUDFLARED_TUNNEL_NAME_01`, ... | Co, neu khong dung key don | Fallback khi khong set `CLOUDFLARED_TUNNEL_NAME`; tat ca gia tri hop le phai tro ve cung 1 tunnel name |
| `CLOUDFLARED_TUNNEL_DOMAIN_00` | Co | Domain dau tien can route vao tunnel |
| `CLOUDFLARED_TUNNEL_DOMAIN_01`, `CLOUDFLARED_TUNNEL_DOMAIN_02`, ... | Khong | Domain bo sung, duoc sap xep theo suffix |

#### Tuy chon

| Bien | Mac dinh | Tac dung |
| --- | --- | --- |
| `SSH_PORT` | `2222` | Neu hostname bat dau bang `ssh`, service se map thanh `ssh://127.0.0.1:<SSH_PORT>` |
| `CLOUDFLARED_DEFAULT_SERVICE` | `http://127.0.0.1:80` | Service mac dinh cho host khong bat dau bang `ssh` |
| `CLOUDFLARED_HOME` | rong | Them noi tim credentials `.json` |
| `CLOUDFLARED_CONFIG` | rong | Neu tro toi folder hoac file yaml, CLI se dung de tim credentials |
| `HOME`, `USERPROFILE` | theo he dieu hanh | Duoc dung de quet `~/.cloudflared` |

### Dau vao logic

- Tunnel name duoc resolve theo thu tu:
  - `CLOUDFLARED_TUNNEL_NAME`
  - neu khong co thi tim cac key `CLOUDFLARED_TUNNEL_NAME_XX`
- Domain list duoc lay tu `CLOUDFLARED_TUNNEL_DOMAIN_XX`.
- Neu nhieu key `CLOUDFLARED_TUNNEL_NAME_XX` co nhieu gia tri khac nhau, CLI se bao loi.
- Neu domain rong, CLI se bo qua key do va in warning.

### Dau ra tren disk

#### `cloudflared-config.yml`

- Tao tai `./cloudflared-config.yml`.
- Chua:
  - `tunnel: <TunnelID hoac tunnel ref>`
  - `credentials-file: /etc/cloudflared/credentials.json`
  - `ingress` cho tung domain
  - dong cuoi `service: http_status:404`

#### `cloudflared-credentials.json`

- Tao tai `./cloudflared-credentials.json`.
- Chua credentials co san hoac du lieu fallback.
- Chen them metadata:
  - `tunnel_name`
  - `tunnel_ref`
  - `tunnul_domain`
  - `tunnul_domains`
  - `cloudflared_config_yml`
  - `cloudflared_config_file`
  - `source_credentials_file`
  - `base64`

### Dau ra tren stdout

- In working directory.
- In tunnel name va danh sach domains.
- In tung command `cloudflared` duoc chay.
- In `stdout`, `stderr`, `exit` cho tung command.
- In summary cuoi cung:

```text
summary: tunnel_created=<0|1>, dns_success=<N>, dns_failed=<N>
```

### Exit code

- `0`: thanh cong, hoac user huy o buoc confirm.
- `1`: validate env loi, tao tunnel that bai, hoac co DNS route that bai.

### Vi du

```powershell
$env:CLOUDFLARED_TUNNEL_NAME = "my-app"
$env:CLOUDFLARED_TUNNEL_DOMAIN_00 = "app.example.com"
$env:CLOUDFLARED_TUNNEL_DOMAIN_01 = "ssh-app.example.com"
$env:SSH_PORT = "2222"
runnerCLI-createtunnel
```

Khong hoi confirm:

```powershell
runnerCLI-createtunnel --yes
```

## 3. runnerCLI-tailscale

### Tac dung

- Xin OAuth access token tu Tailscale.
- Doc ACL body tu file hujson.
- Goi API `POST /api/v2/tailnet/{tailnet}/acl`.

### Cu phap

```powershell
runnerCLI-tailscale [action] [--tailnet <name>] [--body-file <path>] [--dry-run]
```

### Doi so dong lenh

| Doi so | Bat buoc | Tac dung |
| --- | --- | --- |
| `action` | Khong | Hien tai ho tro `access-controls` hoac `acl`; mac dinh la `access-controls` |
| `--action <value>` | Khong | Dat action bang option thay vi positional arg |
| `--tailnet <name>` | Khong | Override tailnet slug/domain |
| `--body-file <path>` | Khong | Override duong dan file hujson |
| `--dry-run` | Khong | Chi validate env + file, khong goi API |
| `--help`, `-h` | Khong | In huong dan su dung |

### Bien moi truong dau vao

#### Bat buoc

| Bien | Bat buoc | Mo ta |
| --- | --- | --- |
| `TAILSCALE_CLIENT_ID` hoac `TS_CLIENT_ID` | Co | OAuth client id |
| `TAILSCALE_CLIENT_SECRET` hoac `TS_CLIENT_SECRET` | Co | OAuth client secret |

#### Tuy chon

| Bien | Mac dinh | Tac dung |
| --- | --- | --- |
| `TAILSCALE_TAILNET` | `-` | Tailnet slug/domain |
| `TAILSCALE_ACL_BODY_FILE` | rong | Duong dan file hujson |
| `TAILSCALE_OAUTH_SCOPE` | rong | OAuth scope neu can |
| `TAILSCALE_API_BASE_URL` | `https://api.tailscale.com` | Doi API base URL |
| `TAILSCALE_API_TIMEOUT_MS` | `30000` | Timeout cho request |

### Thu tu tim ACL body file

Neu khong truyen `--body-file` va khong set `TAILSCALE_ACL_BODY_FILE`, CLI tim theo thu tu:

1. `./tailscale/access-controls.hujson`
2. `./tailscale-acl.hujson`
3. file bundled trong package: [`tailscale/access-controls.hujson`](./tailscale/access-controls.hujson)

### Dau vao

- OAuth credentials.
- Tailnet.
- File hujson khong rong.

### Dau ra tren stdout

- In:
  - action
  - api base url
  - tailnet
  - body file
  - auth mode
- Khi chay that:
  - log buoc xin OAuth token
  - log ma status HTTP
  - log response summary rut gon
  - summary cuoi:

```text
summary: access_controls_updated=1
```

### Dau ra tren disk

- Khong tao file moi.

### Exit code

- `0`: thanh cong, hoac dry-run validate thanh cong.
- `1`: thieu env auth, khong tim thay file body, body rong, request API that bai, hoac doi so sai.

### Vi du

```powershell
$env:TAILSCALE_CLIENT_ID = "ts-client-id"
$env:TAILSCALE_CLIENT_SECRET = "ts-client-secret"
$env:TAILSCALE_TAILNET = "-"
runnerCLI-tailscale
```

Dry run:

```powershell
runnerCLI-tailscale --dry-run
```

Chi ro body file:

```powershell
runnerCLI-tailscale --body-file .\tailscale\access-controls.hujson
```

## 4. runnerCLI-patch-env

### Tac dung

- Quet file `.env`.
- Tim comment dang `# Path: <duong-dan-file>`.
- Doc file duoc chi dinh, encode sang base64.
- Ghi gia tri vao dong env assignment hop le tiep theo neu key ket thuc bang `_BASE64`.

### Cu phap

```powershell
runnerCLI-patch-env <path-to-.env>
runnerCLI-patch-env --file <path-to-.env>
```

### Doi so dong lenh

| Doi so | Bat buoc | Tac dung |
| --- | --- | --- |
| `<path-to-.env>` | Co, neu khong dung `--file` | Duong dan toi file `.env` can patch |
| `--file <path>` | Co, neu khong dung positional | Chi ro file `.env` |
| `-f <path>` | Khong | Alias cua `--file` |
| `--env-file <path>` | Khong | Alias cua `--file` |
| `--env <path>` | Khong | Alias cua `--file` |
| `--dry-run` | Khong | Khong ghi file, chi in ket qua du kien |
| `--help`, `-h` | Khong | In huong dan su dung |

### Format dau vao bat buoc

CLI chi patch khi gap pattern:

```text
# Path: ./cloudflared-config.yml
CLOUDFLARED_CONFIG_YML_BASE64=
```

Quy tac:

- `# Path:` ap dung cho dong env assignment hop le tiep theo.
- Co the co dong trong va comment o giua.
- Key phai ket thuc bang `_BASE64`.
- Path tuong doi duoc resolve theo thu muc chua file `.env`.
- Ho tro path tuyet doi, `~`, va `~/...`.

### Dau ra tren stdout

- In mode `dry-run` hoac `write`.
- In tung key duoc update:
  - key
  - path goc
  - file da doc
  - so byte
  - do dai base64
- In warnings neu:
  - `# Path:` rong
  - `# Path:` bi de
  - dong tiep theo khong phai env assignment
  - key khong ket thuc bang `_BASE64`
- In summary cuoi:

```text
summary: updated=<N>, skipped=<N>, failed=<N>
```

### Dau ra tren disk

- Neu khong co `--dry-run`: ghi de chinh file `.env`.
- Giu nguyen kieu newline goc (`LF`/`CRLF`) cua file.
- Giu comment cuoi dong env neu co.

### Exit code

- `0`: thanh cong, ke ca khi co warnings.
- `1`: khong tim thay `.env`, khong doc/ghi duoc file, hoac khong tim thay source file can encode.

### Vi du

```powershell
runnerCLI-patch-env .env
runnerCLI-patch-env .env --dry-run
runnerCLI-patch-env --file .\.env
```

## Mau cau hinh nhanh

### Mau env cho create tunnel

```powershell
$env:CLOUDFLARED_TUNNEL_NAME = "my-app"
$env:CLOUDFLARED_TUNNEL_DOMAIN_00 = "app.example.com"
$env:CLOUDFLARED_TUNNEL_DOMAIN_01 = "ssh-app.example.com"
$env:SSH_PORT = "2222"
```

### Mau env cho tailscale

```powershell
$env:TAILSCALE_CLIENT_ID = "ts-client-id"
$env:TAILSCALE_CLIENT_SECRET = "ts-client-secret"
$env:TAILSCALE_TAILNET = "-"
```

### Mau `.env` cho patch-env

```text
# Path: ./cloudflared-credentials.json
CLOUDFLARED_CREDENTIALS_JSON_BASE64=

# Path: ./cloudflared-config.yml
CLOUDFLARED_CONFIG_YML_BASE64=
```

## Ghi chu van hanh

- `runnerCLI` thich hop cho chay tay. Trong CI/CD nen goi truc tiep command cu the.
- `runnerCLI-createtunnel` phu thuoc vao binary `cloudflared` tren may.
- `runnerCLI-tailscale` khong sua file local, chi goi API.
- `runnerCLI-patch-env` sua file tai cho, nen dung `--dry-run` neu muon kiem tra truoc.
