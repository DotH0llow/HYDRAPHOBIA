# LIMIAR — Nível 0

Jogo web de terror e sobrevivência em primeira pessoa. A exploração acontece por point-and-click: cada direção troca o cenário, objetos podem ser examinados ou coletados, itens são usados diretamente no ambiente e entidades exigem decisões rápidas.

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

## Sistemas implementados

- Sete pontos de exploração conectados, com quatro cenários e duas entidades originais.
- Hotspots com highlight e descrições contextuais.
- Inventário com usar, examinar, descartar e aplicação direta no cenário.
- Vida, fome e sede atualizadas por tempo decorrido.
- Recursos consumíveis: ração, água de amêndoas e kit médico.
- Duas entidades com aparições dirigidas e probabilísticas.
- Decisões rápidas, dano, jumpscares configuráveis e game over.
- Progresso e configurações persistidos em `localStorage`.
- Áudio procedural após a primeira interação do jogador.
- Layout responsivo e tela cheia.

## Cloudflare Pages

- Build command: `npm run build`
- Build output directory: `dist`
- Node.js: `22`

Os arquivos `public/_headers` e `public/_redirects` são copiados automaticamente para o build.

## Versão anterior

As mecânicas de **A Última Vigília** foram removidas da árvore atual, mas permanecem recuperáveis. Consulte [LEGACY.md](./LEGACY.md).

## Assets e licença

Consulte [LICENSES.md](./LICENSES.md). Nenhum asset externo é carregado em runtime.
