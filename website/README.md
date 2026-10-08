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

O botão **Weitere Hilfe** abre um painel com duas opções: instalar o aplicativo e escrever para a EDV. O download desse painel consulta exclusivamente a release pública marcada como `latest` no repositório oficial `Diakonissenmutterhaus/DMHKontaktApp`. Apenas versões SemVer estáveis, sem `draft` ou `prerelease`, e com o instalador Windows assinado no padrão `DMH.Backup_<versão>_x64-setup.exe` são usadas para o download direto. Se a consulta não estiver disponível, o link abre a página oficial da release mais recente em vez de escolher um arquivo não confirmado.

Os recortes de tela que destacam os botões são feitos em SVG diretamente no HTML, a partir das capturas originais. O texto abaixo do vídeo oferece instruções escritas, mas não substitui legendas sincronizadas. Para adicioná-las sem inventar falas, é necessária uma transcrição revisada do áudio. O bloco de ajuda pode receber um telefone/e-mail da EDV quando houver um contato oficial confirmado.
