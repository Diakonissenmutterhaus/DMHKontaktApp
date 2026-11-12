# DMH Backup – Kurzanleitung

Site de instruções em alemão e painel privado de relatórios, em projetos separados na Vercel.

Site público: https://dmh-backup.vercel.app

Nova etapa de migração: https://migration.dmh-aidlingen.de/ (`dmh-migration`).
O acesso EDV fica diretamente em `/login`, sem botão na página pública. A raiz mostra somente o vídeo, o passo a passo por tela, os prints disponíveis e o download do aplicativo.
Com `REPORTING_SITE_ONLY=1`, o build usa `migration/` como página inicial e inclui a API e o painel EDV separado.
O vídeo desta etapa e os prints completos são configurados em `migration/migration-media.js`.
Veja [relatórios de procedimentos](../docs/procedure-reporting.md).

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

O projeto Vercel `dmh-backup` usa integração Git com **`website`** como *Root Directory*. O projeto `dmh-migration` tem publicação separada. Não publicar a raiz do aplicativo como site nem misturar os acessos administrativos dos dois projetos.

O site de instruções não envia dados. O painel de migração recebe somente relatórios de PCs previamente configurados pela EDV; a versão pública 0.1.37 ainda não tem esse envio.

O botão **Weitere Hilfe** abre um painel com o instalador do aplicativo, o agente Windows para a migração do LAN ao novo Active Directory e o contato da EDV. O download do DMH Backup consulta exclusivamente a release pública marcada como `latest` no repositório oficial `Diakonissenmutterhaus/DMHKontaktApp`. Apenas versões SemVer estáveis, sem `draft` ou `prerelease`, e com o instalador Windows assinado no padrão `DMH.Backup_<versão>_x64-setup.exe` são usadas para o download direto. Se a consulta não estiver disponível, o link abre a página oficial da release mais recente em vez de escolher um arquivo não confirmado.

O agente `downloads/DiakonissenMutterhaus_AidlingenLANneuesAD_Agent.exe` é servido diretamente pelo site. Antes desta publicação, a assinatura Authenticode foi validada como pertencente à `ZOHO Corporation Private Limited`; SHA-256: `C8352A32BCAB7862C53FD7E22904904B68748A2804454800CF4C618EFEF05599`.

Os recortes de tela que destacam os botões são feitos em SVG diretamente no HTML, a partir das capturas originais. O texto abaixo do vídeo oferece instruções escritas, mas não substitui legendas sincronizadas. Para adicioná-las sem inventar falas, é necessária uma transcrição revisada do áudio. O bloco de ajuda pode receber um telefone/e-mail da EDV quando houver um contato oficial confirmado.
