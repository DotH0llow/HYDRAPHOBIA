# A Última Vigília

Jogo de terror psicológico medieval, point-and-click e sobrevivência feito para navegador. Você é o último sentinela de uma torre amaldiçoada e precisa sobreviver da meia-noite às 06:00 administrando energia, portões, um espelho de vidência e o ritual do sino.

## Jogar localmente

Requer Node.js 20 ou superior.

```bash
npm install
npm run dev
```

Abra o endereço exibido pelo Vite. O áudio é liberado após a primeira interação, conforme as regras dos navegadores.

## Comandos

```bash
npm run dev       # servidor local
npm run test      # testes automatizados
npm run build     # build de produção em dist/
npm run preview   # visualizar o build
```

## Como jogar

- `A` e `D`: alternam os portões oeste e leste.
- `M`: abre ou fecha o espelho de vidência.
- `B`: toca o sino ritual na terceira noite.
- `Esc`: fecha o espelho ou pausa a partida.

O Cavaleiro Oco avança pelo oeste e é bloqueado pelo portão. A Viúva do Véu avança pelo leste e às vezes desaparece do espelho. O Monge Cego entra diretamente na torre; o sino só o repele quando ele já iniciou o ritual. Tocar cedo atrai as outras criaturas.

## Arquitetura

- `src/config`: parâmetros centrais de energia, noites e inimigos.
- `src/core`: loop de timestep fixo, eventos, aleatoriedade e orquestração da partida.
- `src/entities`: FSM independente dos inimigos.
- `src/systems`: tempo, energia, portões, rituais, áudio e persistência.
- `src/ui`: telas, HUD e controles.
- `tests`: regras puras com Vitest e aleatoriedade determinística.

Em desenvolvimento há um painel `DEBUG` para energia, tempo, velocidade, ataques e log recente. O painel é eliminado pelo Vite no build de produção.

## Cloudflare Pages

O projeto é inteiramente estático e não requer servidor em produção.

- Comando de build: `npm run build`
- Diretório de saída: `dist`
- Versão recomendada do Node.js: `22`
- Rota raiz: `/`

Os arquivos `public/_headers` e `public/_redirects` são copiados para o build e reconhecidos pelo Cloudflare Pages.

## Salvamento e privacidade

Progresso, melhores resultados e preferências ficam somente no `localStorage` do navegador. Não há login, analytics, backend ou transmissão de dados.

## Referências e licenças

Consulte [LICENSES.md](./LICENSES.md). O projeto não inclui conteúdo protegido de FNAF nem código AGPL.
