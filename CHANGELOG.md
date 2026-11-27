# Histórico de versões

## 1.0.0 — 27/11/2026

Primeira versão do Matiz.

**Aba Paint:** editor de imagens no estilo do Paint do Windows 11, com menus Arquivo, Editar, Imagem, Camada, Exibir e Ajuda, faixa de ferramentas com os grupos Seleção, Imagem, Ferramentas, Pincéis, Formas, Tamanho, Cores e Camadas, barra de opções da ferramenta e barra de status com posição, seleção, tamanho da imagem, tamanho do arquivo e zoom.

**Seleção:** retangular, de forma livre e automática de objeto; selecionar tudo, inverter seleção, excluir e seleção transparente; mover com o mouse ou as setas e esticar pelas oito alças; menu do botão direito.

**Seleção automática de objeto e fundo transparente:** detecta o objeto principal sozinha, por clique ou por um retângulo opcional (modelo do fundo por k-médias no OKLab, limite de Otsu e preenchimento a partir das bordas); borda sem serrilhado, com contorno alisado e transparência calculada por *alpha matting*; descontaminação da cor da borda, sem halo; Manter só o objeto, Remover o objeto, Remover fundo e Tornar fundo transparente com prévia; imagem nova com fundo transparente.

**Imagem:** cortar, redimensionar por porcentagem ou pixels (com ou sem suavizar) e inclinar, girar 90° e 180°, virar na horizontal e na vertical, inverter cores e aparar bordas transparentes, na seleção ou na imagem inteira; alças para mudar o tamanho da tela.

**Ferramentas:** lápis, preenchimento com tolerância, texto formatado (fonte, tamanho, negrito, itálico, sublinhado, tachado, alinhamento e fundo), borracha (transparente ou Cor 2, e troca de cor com o botão direito), seletor de cores e lupa.

**Pincéis e formas:** nove pincéis (pincel, pincel caligráfico, caneta caligráfica, aerógrafo, óleo, giz de cera, marcador, lápis natural e aquarela) com tamanho e opacidade; 23 formas editáveis depois de desenhadas, com contorno e preenchimento em sete estilos.

**Cores:** Cor 1 e Cor 2, 20 cores básicas, 10 personalizadas, Editar cores (espectro, hex, RGB e HSV) e mais nove conjuntos de cores para a grade.

**Camadas:** nova, duplicar, mesclar, subir, descer, arrastar, renomear, ocultar e opacidade.

**Arquivos:** abrir PNG, JPEG, BMP, GIF, WEBP, ICO, SVG, AVIF e `.matiz`; salvar em PNG (com DPI), JPEG, BMP, GIF, TIFF, WEBP, ICO e no projeto `.matiz` com camadas; arquivos recentes; importar de arquivo ou da câmera; colar da área de transferência do sistema e arrastar imagens para a tela; imprimir, configurar página e visualizar impressão; compartilhar; plano de fundo da área de trabalho (app desktop); propriedades da imagem; rascunho automático.

**Exibir:** zoom de 12,5% a 3200%, ajustar à janela, réguas, linhas de grade, barra de status, miniatura flutuante, painel de camadas e tela inteira.

**Aba Pixel Art:** o editor do Crivo sem animação (sem linha do tempo, quadros, papel cebola, GIF animado, Caderno e Estúdio de jogo), com armazenamento próprio e o formato `.matizpx`; abre arquivos `.crivo`.

**Interface:** cinco paletas da interface sem nome, tema claro e escuro sincronizados entre as duas abas.

**App desktop:** `Matiz.exe` em Go com WebView2, aberto centralizado na tela, com atalho no menu Iniciar, janela Salvar como nativa e plano de fundo da área de trabalho.

**Qualidade e segurança:** 141 testes do núcleo, 9 testes ponta a ponta, Content-Security-Policy com hash, nenhuma conexão de rede e validação de todos os arquivos abertos.
