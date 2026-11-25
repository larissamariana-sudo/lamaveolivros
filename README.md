# Lamaveo – Editora e Livraria (GitHub Pages)

Site estático. O sistema (pedidos, estoque, pagamentos, autores) roda no Google Apps Script (`backend/Code.gs`).

```
index.html            site (vitrine, carrinho, autores, rastreio)
painel.html           painel da editora  ->  /painel.html
capas/                capas dos livros (usadas pelo site e pela planilha)
backend/Code.gs       sistema para colar no Apps Script
livros_iniciais.csv   16 livros para importar na aba Livros da planilha
termo-de-publicacao.pdf   (adicionar)
```

## Publicar
1. Crie o repositório `lamaveo` no GitHub (sem README) e envie estes arquivos:
   ```bash
   git init && git add . && git commit -m "Lamaveo: site"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/lamaveo.git
   git push -u origin main
   ```
2. GitHub > **Settings > Pages** > Source: *Deploy from a branch* > `main` / `(root)` > Save.
   O site abre em `https://SEU-USUARIO.github.io/lamaveo/`.
3. Domínio: em Pages > **Custom domain** digite `www.lamaveo.com.br` > Save (o GitHub cria o arquivo CNAME).
   No DNS da Locaweb: **CNAME** `www` -> `SEU-USUARIO.github.io`.
   Para `lamaveo.com.br` sem www: registros **A** para 185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153
   (confirme na documentação do GitHub Pages) ou redirecione para o www pela Locaweb.
4. Quando o DNS propagar, marque **Enforce HTTPS**.

## Conectar o sistema
1. Planilha Google > Extensões > Apps Script > cole `backend/Code.gs` > rode `setup`.
2. Propriedades do script: `MP_TOKEN`, `SITE` (https://www.lamaveo.com.br/), `ME_TOKEN`, `CEP_ORIGEM`, `ADMIN_KEY`.
3. Implantar > App da Web (executar como você; acesso: qualquer pessoa) > copie a URL `/exec`.
4. Cole a URL em `var API_URL = "";` no `index.html` e no `painel.html`; preencha `REM` no painel; commit e push.
5. Na aba **Livros**, importe `livros_iniciais.csv` (Arquivo > Importar > Anexar linhas).
   **Atenção:** o estoque vem 0, então os livros aparecem como "Esgotado" até você informar as quantidades.

## Segurança
Nunca coloque no repositório tokens do Mercado Pago/Melhor Envio nem a ADMIN_KEY. Repositório público mostra todo o código;
isso é seguro porque os segredos ficam só no Apps Script.
