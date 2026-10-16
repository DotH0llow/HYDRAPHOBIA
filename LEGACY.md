# Legacy — A Última Vigília

A implementação medieval anterior foi removida da árvore atual em 16 de outubro de 2026 para dar lugar ao jogo de exploração das Backrooms.

Ela continua integralmente preservada no histórico Git, no commit:

```text
62bb78604bae20575a71e0ec86d713db0a97e73e
```

## Mecânicas preservadas

- Três noites configuráveis, das 00:00 às 06:00.
- Energia arcana com consumo passivo e custos de portões, luz e espelho.
- Portões oeste e leste com estados e animações intermediárias.
- Espelho de vidência com seis regiões observáveis.
- FSMs independentes para Cavaleiro Oco, Viúva do Véu e Monge Cego.
- Estados `DORMANT`, `PATROLLING`, `APPROACHING`, `AT_GATE`, `ATTACKING`, `RETREATING`, `COOLDOWN` e `STUNNED`.
- Ritual do sino, cooldown e risco de atrair outras criaturas.
- Áudio procedural, progressão de noites e salvamento local.
- Loop de timestep fixo, debug de desenvolvimento e 19 testes automatizados.

## Como recuperar

Para abrir a versão anterior em uma branch separada:

```bash
git switch -c legacy-ultima-vigilia 62bb78604bae20575a71e0ec86d713db0a97e73e
```

Para resgatar somente um arquivo específico sem trocar de branch:

```bash
git restore --source=62bb78604bae20575a71e0ec86d713db0a97e73e -- caminho/do/arquivo
```

Não copie sistemas inteiros para o jogo atual sem revisar dependências e conflitos de conceitos. Os sistemas mais fáceis de reaproveitar isoladamente são `AudioSystem`, `SaveSystem`, `GameLoop` e `SeededRandom`.
