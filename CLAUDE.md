# HYDRAPHOBIA — como trabalhar neste repositório

## A cópia local é sempre a mesma pasta

O projeto é jogado e editado no navegador a partir de **`K:\HYDRAPHOBIA\repo`**. Esse é
o único lugar: não clone o repositório em outra pasta para "trabalhar separado", porque
o estado do jogo e do editor está preso a esta cópia.

```bash
npm install
npm run dev     # jogo em /, editor em /editor.html
```

O remoto é `origin` → `https://github.com/DotH0llow/mimosferatu.git`, e o ramo de
trabalho é a `main`.

## Onde estão o mapa e o progresso

O editor e o jogo guardam tudo no `localStorage` do navegador. Isso é invisível para o
Git, então, **em desenvolvimento**, `scripts/localSync.mjs` (plugin do Vite) espelha os
dois em disco, dentro do repositório:

| Arquivo | O que é | Chave no navegador |
| --- | --- | --- |
| `data/project.json` | Projeto do editor: níveis, salas, interagíveis, luzes, mídias, itens, entidades | `limiar:room-editor:v1` |
| `data/progress.json` | Os quatro registros de campanha e as configurações | `limiar:save:v3` |

Como funciona, nos dois sentidos:

- **Ao abrir** a página (`src/main.ts` e `src/editor-main.ts`), `pullAllFromDisk()`
  compara o `updatedAt` do arquivo com o do `localStorage` e fica com o mais recente.
  Depois de um `git pull`, o navegador pega a versão que veio do repositório.
- **A cada gravação** do editor ou do jogo, `syncToDisk()` reescreve o arquivo
  correspondente (com uma espera curta, para não gravar a cada tecla).
- **O botão "Enviar à main"**, na barra do editor, commita *apenas* `data/` e dá push
  em `HEAD:main`. Nada mais da árvore de trabalho entra nesse commit.

**Começando uma conversa nova sobre este projeto:** leia `data/project.json` e
`data/progress.json` antes de supor qualquer coisa sobre o mapa ou sobre o estado das
campanhas — eles são a cópia local atualizada, e não o que estiver escrito no README ou
em `src/config/world.ts`. `src/config/world.ts` é só o mapa de fábrica, usado quando
ainda não existe projeto salvo.

Em produção (Cloudflare Pages) nada disso roda: o build é estático e o jogo vive inteiro
no `localStorage` do jogador.

## Comandos

```bash
npm run test     # vitest
npm run build    # tsc -b && vite build
npm run preview  # prévia do build
```

Rode `npm run test` e `npx tsc -b` antes de commitar.

## Convenções do código

- Todo texto de interface é em **português do Brasil**.
- Comentários explicam **por que**, não o que o código faz; são escritos em português e
  costumam contar o problema que aquela linha resolve.
- Sem framework: TypeScript puro, `innerHTML` com `esc()` em tudo que vem de dados.
- O editor e o jogo compartilham o desenho dos caminhos (`src/styles/paths.css`) e o
  enquadramento da cena (`src/systems/roomView.ts`) de propósito — mexer em um lugar
  muda os dois juntos.
