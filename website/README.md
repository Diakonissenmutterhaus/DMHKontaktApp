# DMH Backup – Kurzanleitung

Site estático em alemão, pronto para usar como projeto independente no Vercel.

## Pré-visualizar localmente

Na raiz do repositório:

```powershell
py -3 -m http.server 4173 --directory website
```

Abra `http://localhost:4173`. O vídeo local está em `website/media/dmh-backup-anleitung.mp4`.

## Publicar depois no Vercel

1. Revise o vídeo e as capturas antes de torná-los públicos. Eles podem mostrar informações da área de trabalho.
2. Envie o vídeo para um serviço de mídia público, como **Vercel Blob**, e copie a URL pública. O arquivo original tem mais de 100 MiB, então não deve ser incluído como arquivo comum no GitHub.
3. Cole a URL em `website/video-config.js` no valor de `window.DMH_BACKUP_VIDEO_URL`.
4. No Vercel, importe o repositório e selecione **`website`** como *Root Directory*. Use o preset **Other**, sem comando de build; o diretório de saída é `.`.
5. Confira a página e a reprodução do vídeo no link de preview antes de torná-lo público.

Nenhum dado é enviado pelo site; os passos de envio à EDV e importação acontecem somente dentro do aplicativo DMH Backup.
