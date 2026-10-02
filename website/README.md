# DMH Backup – Kurzanleitung

Site estático em alemão, pronto para usar como projeto independente no Vercel.

Site público: https://dmh-backup.vercel.app

## Pré-visualizar localmente

Na raiz do repositório:

```powershell
py -3 -m http.server 4173 --directory website
```

Abra `http://localhost:4173`. A versão otimizada do vídeo está em `website/media/dmh-backup-anleitung-web.mp4` (aprox. 18 MiB). O original, sem compressão adicional, permanece só no computador local.

## Publicar depois no Vercel

1. Revise o vídeo e as capturas antes de torná-los públicos. Eles podem mostrar informações da área de trabalho.
2. No Vercel, importe o repositório e selecione **`website`** como *Root Directory*. Use o preset **Other**, sem comando de build; o diretório de saída é `.`.
3. Confira a página, as imagens e a reprodução do vídeo no link de preview antes de torná-lo público. O vídeo otimizado é servido como arquivo estático do próprio site; não é necessário configurar Vercel Blob.

O projeto Vercel `dmh-backup` está vinculado localmente à pasta `website`; o deploy atual foi feito diretamente dessa pasta. A integração automática com o Git não foi ativada. Antes de conectá-la no futuro, defina **`website`** como *Root Directory* do projeto para não publicar arquivos da raiz do aplicativo.

Nenhum dado é enviado pelo site; os passos de envio à EDV e importação acontecem somente dentro do aplicativo DMH Backup.
