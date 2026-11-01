# IPA Manager — Preview 0.1.0

PWA em português para iPhone e navegadores modernos. Faz leitura e inspeção local de arquivos `.ipa`, consulta releases públicas do GitHub e importa catálogos compatíveis com o formato AltStore JSON.

## O que está implementado

- Importação de IPA pelo seletor de arquivos do navegador.
- Leitura do diretório ZIP (métodos STORE e Deflate), sem enviar o arquivo para servidor.
- Leitura de `Payload/*.app/Info.plist` em formato XML e binary plist.
- Exibição do bundle ID, versão, build, nome, versão mínima do iOS e estrutura do arquivo.
- Extração individual de arquivos e compartilhamento pelo menu nativo quando suportado.
- Validação CRC-32 de uma entrada quando ela é extraída.
- Cálculo SHA-256 e comparação com hash de referência.
- Indicadores de assinatura: presença de `CodeResources` e `embedded.mobileprovision` (não valida a assinatura criptográfica).
- Consulta de releases e assets `.ipa`/`.zip` em repositórios GitHub públicos.
- Importação de fontes AltStore JSON via HTTPS, com apps, versões e links.
- Biblioteca/histórico local no `localStorage`.
- Service worker para cache do shell após a primeira visita.

## Limites intencionais de segurança e plataforma

O IPA Manager é um PWA. Um site/PWA não possui APIs públicas para assinar apps iOS, instalar qualquer IPA ou contornar os mecanismos de confiança do iOS. O app não solicita Apple ID, senha, UDID, certificado privado nem perfil de provisionamento pessoal.

A instalação precisa ocorrer por uma via compatível: App Store, marketplace/distribuição web autorizada pela Apple no Brasil, ou um instalador de sideload que o próprio usuário já tenha configurado e que aceite o arquivo compartilhado. A inclusão de uma fonte AltStore JSON apenas importa metadados e links; ela não equivale a aprovação da Apple ou autorização de marketplace.

A tela de inspeção indica arquivos que parecem relacionados à assinatura, mas não faz validação CMS/CodeDirectory completa, revogação de certificado, notarização ou validação Apple online. Nunca interpreta a presença desses arquivos como prova de que o IPA pode ser instalado.

## Como publicar

Hospede a pasta inteira em um host estático com HTTPS, como GitHub Pages ou Cloudflare Pages. Não remova `manifest.webmanifest`, `sw.js` ou `icon.svg`. O site não precisa de backend para a inspeção local.

Para GitHub Pages:
1. Crie um repositório público vazio.
2. Envie todos os arquivos desta pasta para a raiz do repositório.
3. Em Settings → Pages, escolha Deploy from a branch e a branch `main`, pasta `/ (root)`.
4. Abra a URL HTTPS gerada no Safari do iPhone.
5. No Safari, toque em Compartilhar → Adicionar à Tela de Início → ative “Abrir como App da Web” → Adicionar.

## Teste no iPhone

- O seletor de arquivos aceita `.ipa` pelo app Arquivos.
- A descompressão utiliza a API nativa `DecompressionStream('deflate-raw')`, suportada no Safari/iOS 16.4+.
- Arquivos grandes podem consumir bastante memória. A recomendação inicial é até 500 MB.
- A exportação individual usa Blob e pode abrir a folha de compartilhamento/Downloads conforme a versão do Safari.
- Consultas externas dependem da disponibilidade de rede e das permissões CORS do site consultado.

## Estrutura

- `index.html` — layout e telas.
- `styles.css` — interface responsiva.
- `app.js` — ZIP, plist, CRC, SHA-256, GitHub, fontes e biblioteca.
- `sw.js` — cache offline do shell.
- `manifest.webmanifest` — configuração da PWA.
- `icon.svg` — ícone vetorial.

## Compatibilidade

Navegadores recentes com `DecompressionStream('deflate-raw')`, `crypto.subtle`, `Blob`, `File` e `DOMParser`. Para iPhone, use Safari atualizado e sirva o app por HTTPS ou localhost.

## Limites conhecidos do Preview 0.1.0

- ZIP64, arquivos ZIP multi-volume e entradas criptografadas não são aceitos.
- A inspeção bloqueia pacotes acima de 700 MB; a extração individual bloqueia uma entrada acima de 250 MB; cálculo SHA-256 é limitado a 300 MB nesta versão para reduzir risco de falta de memória.
- A lista visual mostra até 700 entradas por vez; a busca refina o conjunto completo.
- O histórico guarda metadados, não o IPA em si. O service worker guarda apenas os arquivos da interface, não os pacotes baixados.
- A leitura do diretório ZIP e os metadados do app são analisados; o verificador não substitui ferramentas forenses nem a validação oficial do iOS.
