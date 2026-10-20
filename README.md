# HYDRAPHOBIA — Nível 0

Jogo web de terror e sobrevivência em primeira pessoa (antes chamado *Mimosferatu* / *Limiar*). A exploração acontece por point-and-click: cada direção troca o cenário, objetos podem ser examinados ou coletados, itens são usados diretamente no ambiente e entidades exigem decisões rápidas.

## Executar localmente

Requer Node.js 22 ou superior.

```bash
npm install
npm run dev
```

## Comandos

```bash
npm run dev       # servidor de desenvolvimento
npm run test      # testes automatizados
npm run build     # build estático em dist/
npm run preview   # prévia do build
```

## Controles

- Clique nas setas ou use `WASD` / setas do teclado para explorar.
- Clique em objetos destacados para examinar, coletar ou utilizar.
- Abra o inventário pelo botão inferior direito ou pela tecla `I`.
- Selecione um cartão ou fusível no inventário e clique no objeto correspondente no cenário.
- `Esc` fecha o inventário ou pausa o jogo.

## Editor visual de salas

Abra `http://localhost:5173/editor.html` durante o desenvolvimento ou use **Editor de salas** no menu principal.

O editor permite criar níveis e perspectivas, arrastar os blocos no canvas, conectar salas, escolher imagens locais, desenhar hotspots sobre a cena e testar o mapa imediatamente. O projeto é salvo automaticamente no navegador em JSON. Os botões **Exportar JSON** e **Importar** permitem manter cópias externas e continuar a edição em outro navegador.

Para disponibilizar novas imagens no seletor, coloque os arquivos em `public/assets/scenes` e informe o caminho relativo, por exemplo `/assets/scenes/minha-sala.jpg`.

## Campanhas e personagem

**Novo jogo** abre a tela de registros: quatro campanhas independentes, cada uma com o
próprio personagem e o próprio progresso. Ao escolher um registro vazio (ou substituir um
existente) começa a criação do personagem, em cinco etapas com botão de voltar em todas:

1. **Gênero** — masculino ou feminino. Define quais arquivos de voz tocam no jogo.
2. **Classe** — explorador, técnico, adolescente ou cavaleiro.
3. **Nome** — até 18 caracteres.
4. **Fobia** — nictofobia, claustrofobia, hemofobia ou monofobia.
5. **Item inicial** — uma entre quatro opções, entregue no inventário ao começar.

Classe e fobia ficam gravadas no registro e aparecem na lista de campanhas; por enquanto
não alteram as mecânicas. Gênero e item inicial já têm efeito no jogo.

## Sistemas implementados

- Sete pontos de exploração conectados, com quatro cenários e duas entidades originais.
- Hotspots com highlight e descrições contextuais; os de "Mudar de sala" aparecem como setas.
- Inventário com usar, examinar, descartar e aplicação direta no cenário.
- Vida, fome e sede atualizadas por tempo decorrido.
- Recursos consumíveis: ração, água de amêndoas e kit médico.
- Duas entidades com aparições dirigidas e probabilísticas.
- Decisões rápidas, dano, jumpscares configuráveis e game over.
- Quatro registros de save com criação de personagem, persistidos em `localStorage`.
- Áudio procedural após a primeira interação do jogador.
- Trilha e efeitos por arquivo, com volume separado para a vocalização do personagem.
- Escuridão por sala com focos de luz de formato, ângulo e flickering configuráveis.
- Layout responsivo e tela cheia.

## Áudio

Os arquivos em `public/assets/audio` são a fonte da verdade: basta soltar um arquivo na
pasta certa e `scripts/audioManifest.mjs` o inclui no manifesto. O nome do arquivo decide
duas coisas: `rare` no nome faz o som tocar raramente, e `male` / `female` (ou `woman`)
restringem o som ao personagem daquele gênero — sem marcação, serve aos dois.

Os sons do próprio personagem (respiração, fome, sede, suspiros, gritos) formam um grupo
exclusivo: nunca tocam dois ao mesmo tempo e têm o próprio controle de volume nas
configurações.

> **Pendência de assets:** a pasta `public/assets/audio/FX/Anxiety` hoje só tem suspiros
> de sala segura e um ataque de pânico. Não há arquivos de ansiedade passiva, então o jogo
> recorre a esses dois enquanto nenhum for adicionado.

## Cloudflare Pages

- Build command: `npm run build`
- Build output directory: `dist`
- Node.js: `22`

Os arquivos `public/_headers` e `public/_redirects` são copiados automaticamente para o build.

## Versão anterior

As mecânicas de **A Última Vigília** foram removidas da árvore atual, mas permanecem recuperáveis. Consulte [LEGACY.md](./LEGACY.md).

## Assets e licença

Consulte [LICENSES.md](./LICENSES.md). Nenhum asset externo é carregado em runtime.
