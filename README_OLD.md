Quero criar um spec para um SDD em node. que siga 3 fases

FASE 1
1 - quero selecionar arquivos PDFs... (lista de PDFs locais)
2 - quero poder extrair o texto destes PDFs (gerar cópias .txt "em batch")
3 - apresentar 
3 - quero poder pegar uma lista desse texto e gerar um arquivo CSV ou XML com cabeçalho e lisa de itens. (gerar .csv ou .xml)
4 - Criar um link para abrir tanto os .pdfs originais, como os .txts quanto os .csvs, .xmls criados 
5 - Manter um log de passos (O que está acontecendo e o que está fazendo cada parte

FASE 2 
2.1 - Criar interfaces de um software (pode ser html) mas pense em algo que possa ser utilizado com um instalador no funturo para windows e linux.
2.1.1 - Deixar expostos Endpoints para uso do que foi produzido na Fase1
2.2 - Funções de CRUD de Modelos de LLM (ollama e OpenRouter (inserir o token )
2.3 - Poder escolher de Listagem de LLMs incluídas (dropdown)
2.4 - Poder Inserir texto para enviar para LLM processar, (escolher da lista de arquivos (txt, csv, xlxs o que enviar)
2.5 - Receber resposta em formato .json da LLM, criar link para a resposta json.
2.6 - Mostrar um resumo do que a LLM respondeu

FASE 3
3.1 - Criar um executável que instale o programa para windows
3.2 - O instalador deve ser um unico arquivo, tipo um standalone app (.exe ou igual)
 

<!-- sudo systemctl start ollama.service -->
<!-- sudo systemctl stop ollama.service -->
<!-- sudo systemctl status ollama.service -->