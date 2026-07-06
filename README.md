# GH Financeiro

Aplicação financeira gerencial para pequenas empresas, focada em uso diário rápido.

## Como abrir

Abra `index.html` no navegador. Os dados ficam salvos no `localStorage` do próprio navegador.

Para uso compartilhado, hospede a pasta e configure o Supabase.

## Recursos implementados

- Dashboard executivo com indicadores automáticos.
- Configuração inicial com caixa, banco, aplicações, estoque inicial e mês de análise.
- Configuração de taxas de PIX, débito e crédito, com cálculo automático de faturamento líquido.
- Lançamentos de vendas, despesas, contas a pagar, dívidas, retiradas, consumo próprio e compras de estoque.
- Cálculo automático de caixa, banco, saldo total, caixa livre, estoque estimado, taxas bancárias, percentuais, ticket médio, sobrevivência e índice de sangramento.
- Alertas inteligentes com semáforo.
- Gráficos executivos em SVG.
- Plano de ação mensal editável.
- Botão de relatório mensal via impressão/PDF do navegador.
- Modo lançamento cego: funcionário registra dados sem visualizar totais, histórico, dashboard ou relatórios.
- Modo gestor protegido por PIN configurável. PIN padrão: `1234`.
- Fechamento mensal: salva um snapshot do mês, mantém histórico e inicia o mês seguinte com lançamentos zerados e saldos iniciais atualizados.

## Observação técnica

O ambiente local desta sessão não possui React/Vite instalados e não permite instalar dependências sem aprovação. Por isso, a entrega atual é autocontida e funcional, sem dependências externas. A estrutura de dados e componentes está preparada para ser portada para React + TypeScript e Supabase no próximo passo.

O modo lançamento oculta os dados na interface, mas a proteção real entre usuários em computadores diferentes exige backend com autenticação e permissões, como Supabase.

## Configurar Supabase

1. Crie um projeto no Supabase.
2. No painel do Supabase, abra **SQL Editor** e execute o arquivo `supabase.sql`.
3. Em **Authentication > Users**, crie o usuário do gestor com e-mail e senha.
4. Em **Project Settings > API**, copie:
   - Project URL
   - anon public key
5. Preencha `supabase-config.js`:

```js
window.GH_SUPABASE = {
  url: "https://SEU-PROJETO.supabase.co",
  anonKey: "SUA_ANON_PUBLIC_KEY",
};
```

6. Hospede a pasta `gh-financeiro`.

Links de uso depois de hospedado:

- Funcionário: `https://seu-dominio/`
- Gestor: `https://seu-dominio/?modo=gestor`

Com as políticas do `supabase.sql`, o funcionário consegue inserir lançamentos, mas não consegue ler o histórico pela interface nem pela API anônima. O gestor precisa fazer login para ler e gerenciar os dados.

## Fechar mês

No modo gestor, use **Fechar mês**. O sistema:

- salva o mês atual em `gh_monthly_snapshots`;
- registra faturamento, despesas, caixa livre, estoque estimado e indicadores;
- inicia o próximo mês;
- leva caixa, banco e estoque estimados como saldos iniciais;
- mantém dívidas antigas;
- zera vendas, despesas, contas a pagar, retiradas, consumo próprio, compras de estoque e plano de ação.
