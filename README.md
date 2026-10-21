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

**Níveis.** *Novo nível* cria na hora um nível vazio, com uma sala própria e sem nenhuma
conexão herdada. O nome do nível aberto é editável no painel lateral (ou pelo ✎ de cada
nível na lista), e *Excluir nível* remove o nível inteiro junto com os caminhos que
apontavam para ele.

**Caminhos.** Um caminho é o único interagível que leva o jogador a outra sala: arraste o
ponto ◉ de um bloco até outro no mapa e ele nasce — ou use *+ Caminho*, dentro do editor
da perspectiva, para criar um a partir da sala aberta sem voltar ao mapa (o destino nasce
na primeira outra sala do nível e é trocado no painel). Ele tem a mesma aparência no editor e
no jogo — a seta redonda com a etiqueta do destino — e é arrastável sobre a cena para
escolher onde o botão aparece. Projetos antigos que usavam a ação "Mudar de sala" em um
interagível são convertidos em caminhos ao serem abertos, no mesmo ponto da tela.

**Caminhos entre níveis.** O destino de um caminho tem primeiro um seletor de **nível** e
depois a lista de salas daquele nível. O jogo carrega todos os níveis em um mundo só,
então a passagem funciona direto, inclusive no modo de teste.

**Enquadramento.** A cena é sempre enquadrada em 16:9 e ampliada até cobrir a tela, tanto
no palco do editor quanto no jogo: uma coordenada em % cai no mesmo ponto da imagem nos
dois.

**Janela do jogador.** Cada sala pode escolher o próprio campo de visão: o retângulo
sobre o palco é arrastável e redimensionável pelo canto, e o jogo enquadra exatamente
aquele recorte, ampliado até cobrir a tela. Uma janela menor aproxima a cena; movê-la
decide o que o jogador vê naquela sala. O tracejado interno marca o que a proporção da
janela real deste computador ainda corta desse recorte. Sem ajuste nenhum a janela é a
cena inteira, o enquadramento de sempre.

**Mídias da sala.** Além da imagem de fundo, uma sala aceita fotos (`jpg`, `png`,
`webp`), GIFs e vídeos (`webm`, `mp4`) soltos sobre a cena: *+ Mídia* cria um bloco que
se arrasta e se redimensiona como um interagível, com opacidade, rotação e a escolha de
ficar atrás ou à frente dos interagíveis. A mídia é decoração — nada nela é clicável — e
aparece igual no jogo e no modo de teste.

**Copiar, colar e excluir.** `Ctrl+C` copia o que estiver selecionado — interagível,
foco de luz, mídia, sala, item ou entidade — e `Ctrl+V` cola uma cópia independente, com
id próprio e deslocada alguns por cento. `Delete` exclui na hora o que estiver
selecionado na cena: o interagível, a mídia, o foco de luz ou o caminho, nessa ordem.
Salas, níveis, itens e entidades continuam saindo só pelo botão, com confirmação. Um
aviso no canto confirma cada operação.

**Luz.** Cada foco tem formato, raio, intensidade, cor, flickering, uma **abertura** em
graus (360° acende o foco inteiro, 180° deixa meio foco) e uma **rotação** que gira o
formato e escolhe o lado aceso quando a abertura é menor que 360°.

**Áudio da sala.** Cada sala pode forçar um arquivo de `public/assets/audio` quando o
jogador entra, com três modos exclusivos: tocar apenas uma vez por campanha, repetir
continuamente em laço, ou recomeçar a cada entrada. Enquanto a trilha da sala toca, a
trilha do nível fica fora do ar.

Para disponibilizar novas imagens no seletor, coloque os arquivos em `public/assets/scenes` e informe o caminho relativo, por exemplo `/assets/scenes/minha-sala.jpg`.

## Campanhas e personagem

**Novo jogo** abre a tela de registros: quatro campanhas independentes, cada uma com o
próprio personagem e o próprio progresso. Ao escolher um registro vazio (ou substituir um
existente) começa a criação do personagem, em seis etapas com botão de voltar em todas.
Cada etapa exige exatamente uma escolha, e o botão de continuar só liga depois dela:

1. **Gênero** — masculino ou feminino. Define quais arquivos de voz tocam no jogo.
2. **Classe** — explorador, técnico, adolescente ou cavaleiro; com o gênero feminino os
   nomes ficam no feminino (exploradora, técnica, cavaleira) na tela e na ficha.
3. **Nome** — de 3 a 26 caracteres, ao lado da arte da classe escolhida. Um filtro de
   linguagem recusa ofensa racista, xenófoba, homofóbica e apologia ao ódio, inclusive
   disfarçada com números (`n1gg3r`), pontuação (`p.u.t.a`) ou letras esticadas
   (`viaaaado`); o motivo aparece embaixo do campo e o botão de continuar fica desligado
   (`src/config/nameFilter.ts`).
4. **Fobia** — doze opções: nictofobia, claustrofobia, hemofobia, monofobia,
   talassofobia, escopofobia, automatonofobia, necrofobia, fonofobia, mecanofobia,
   tanatofobia e apeirofobia.
5. **Item inicial** — uma entre quatro opções, entregue no inventário ao começar.
6. **Modo** — clássico (com interface) ou imersivo (a tela fica só com a cena). Cada
   opção mostra um exemplo da tela de jogo, montado com as próprias peças da interface
   em miniatura — e não com uma foto guardada, que envelheceria junto com o jogo.

A tela não tem caixas: o título, os numerais e a regra da etapa ficam no canto superior
esquerdo, as opções ocupam o resto da tela e "Voltar" e "Continuar" ficam no meio da base.

**Gênero e classe** vão mais longe: as duas etapas ficam sobre o preto, sem cenário atrás
e sem caixa nenhuma em volta das artes. A arte flutua no escuro, com as bordas dissolvidas
para não virar um retângulo, e só o nome aparece embaixo, em letra grande. A escolha se vê
no brilho — as opções não escolhidas ficam apagadas e a escolhida acende.

Classe e fobia ficam gravadas no registro e aparecem na lista de campanhas; por enquanto
não alteram as mecânicas. Gênero, item inicial e modo já têm efeito no jogo.

**Fim de campanha.** Morrer e escapar encerram o registro do mesmo jeito: o personagem
continua lá, o progresso sai e o card passa a contar como terminou — *Morreu · Setor
alagado* ou *Escapou · O limiar*, com o tempo na ficha e a miniatura da sala do fim.
Um registro encerrado não oferece mais "Continuar"; o caminho é criar outro personagem
nele ou apagá-lo. A morte nunca é gravada, então sem isso o save ficaria parado no
instante anterior a ela e "Continuar" devolveria o jogador para morrer de novo.

Cada classe tem duas artes em `public/assets/characters`: `<classe>.webp` e
`<classe>_feminino.webp`. A tela escolhe a arte pelo gênero já selecionado e cai de volta
na arte comum se o arquivo feminino não existir (`classArtFor`, em
`src/config/character.ts`).

## Sistemas implementados

- Sete pontos de exploração conectados, com quatro cenários e duas entidades originais.
- Hotspots com highlight e descrições contextuais; caminhos entre salas com seta e etiqueta.
- Legendas com prazo e caixa de inventário que só aparece por quatro segundos, depois de
  uma interação ou de um item recebido.
- Modo imersivo: a campanha roda sem nenhuma peça de interface sobre a cena.
- Inventário com usar, examinar, descartar e aplicação direta no cenário.
- Vida, fome e sede atualizadas por tempo decorrido.
- Recursos consumíveis: ração, água de amêndoas e kit médico.
- Duas entidades com aparições dirigidas e probabilísticas.
- Decisões rápidas, dano, jumpscares configuráveis e game over.
- Quatro registros de save com criação de personagem, persistidos em `localStorage`.
- Fim de campanha gravado no registro: morte ou fuga, com a sala e o tempo.
- Áudio procedural após a primeira interação do jogador.
- Trilha e efeitos por arquivo, com volume separado para a vocalização do personagem.
- Escuridão por sala com focos de luz de formato, abertura, rotação e flickering configuráveis.
- Trilha presa a uma sala, com repetição única, contínua ou a cada entrada.
- Caminhos que atravessam de um nível para outro.
- Campo de visão por sala e mídias (imagem, GIF, vídeo) sobre a cena.
- Filtro de linguagem no nome do personagem.
- Layout responsivo e tela cheia.

## Legendas

Uma legenda sozinha fica **oito segundos** na tela — ela é a única coisa para ler e nada
espera a vez. Um texto acima de 80 caracteres é repartido em legendas de tamanho parecido,
e aí cada pedaço tem o tempo do próprio tamanho: até 20 caracteres, 1,9 s; de 21 a 40,
2,5 s; de 41 a 60, 3,75 s; de 61 a 80, 5,25 s. Segurar cada pedaço por oito segundos faria
o jogador esperar meio minuto por uma frase. A regra toda vive em `src/systems/legends.ts`.

O fundo da legenda tem 15% de transparência, no jogo e no modo de teste do editor.

## Áudio

Os arquivos em `public/assets/audio` são a fonte da verdade: basta soltar um arquivo na
pasta certa e `scripts/audioManifest.mjs` o inclui no manifesto. O nome do arquivo decide
duas coisas: `rare` no nome faz o som tocar raramente, e `male` / `female` (ou `woman`)
restringem o som ao personagem daquele gênero — sem marcação, serve aos dois.

Os sons do próprio personagem (respiração, fome, sede, suspiros, gritos) formam um grupo
exclusivo: nunca tocam dois ao mesmo tempo, sempre soam centrados nos dois ouvidos e têm
o próprio controle de volume nas configurações. A fome e a sede só aparecem abaixo de 40,
e as versões críticas abaixo de 15.

`Esc` congela todo o áudio do jogo junto com o jogo e o retoma exatamente de onde parou;
voltar ao menu principal interrompe por completo o que estava soando.

O painel DEV mostra, em "Tocando agora", o nome único da trilha atual e do último efeito
ouvido, com o arquivo correspondente. Os botões de "Forçar vocalização" sempre cortam o
som atual antes de tocar o novo.

A respiração do personagem tem arquivos próprios por nível de ansiedade, em
`FX/Anxiety/LV1_CALM`, `LV2_UNEASY` e `LV3_TERRIFIED`. O jogo toca a pasta correspondente
ao nível atual; os arquivos soltos na raiz de `FX/Anxiety` entram no nível intermediário.

> **Pendência de assets:** não existe a pasta `FX/Screams`, então a categoria de grito
> (disparada com perigo alto) fica muda. O botão "perigo" do painel DEV avisa isso.

## Cópia local e envio para a main

O editor e o jogo guardam tudo no `localStorage`, que o Git não enxerga. Durante o
desenvolvimento, o plugin `scripts/localSync.mjs` espelha os dois em disco, dentro do
próprio repositório:

- `data/project.json` — o projeto do editor (níveis, salas, interagíveis, luzes, mídias,
  itens, entidades).
- `data/progress.json` — os quatro registros de campanha e as configurações.

Ao abrir a página, o navegador compara o carimbo dos arquivos com o do `localStorage` e
fica com o mais recente — então um `git pull` chega até a aba. A cada gravação, o caminho
inverso: o arquivo é reescrito. O botão **Enviar à main**, na barra do editor, commita
*apenas* `data/` e envia para a `main`; nada mais da árvore de trabalho entra no commit.

A cópia local de trabalho é sempre `K:\HYDRAPHOBIA\repo` — veja [CLAUDE.md](./CLAUDE.md).
Em produção nada disso roda: o build é estático e o jogo vive inteiro no navegador.

## Cloudflare Pages

- Build command: `npm run build`
- Build output directory: `dist`
- Node.js: `22`

Os arquivos `public/_headers` e `public/_redirects` são copiados automaticamente para o build.

## Versão anterior

As mecânicas de **A Última Vigília** foram removidas da árvore atual, mas permanecem recuperáveis. Consulte [LEGACY.md](./LEGACY.md).

## Assets e licença

Consulte [LICENSES.md](./LICENSES.md). Nenhum asset externo é carregado em runtime.
