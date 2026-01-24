# 🚀 Deploy no Google Cloud Platform - Cloud Run

## ✅ Melhor Opção: Cloud Run com Application Default Credentials

### Por que Cloud Run?
- ✅ Serverless (escala automaticamente)
- ✅ Paga apenas pelo uso
- ✅ Sem gerenciar servidores
- ✅ Integração nativa com Firestore
- ✅ Deploy simples com Docker

---

## 📋 Pré-requisitos

1. **Google Cloud SDK instalado**
   ```bash
   # Instalar gcloud CLI
   # https://cloud.google.com/sdk/docs/install
   ```

2. **Projeto GCP criado e billing habilitado**
   ```bash
   gcloud projects create seu-project-id
   gcloud config set project seu-project-id
   ```

3. **APIs habilitadas**
   ```bash
   gcloud services enable run.googleapis.com
   gcloud services enable cloudbuild.googleapis.com
   gcloud services enable containerregistry.googleapis.com
   ```

---

## 🚀 Deploy Rápido (3 comandos)

### 1. Configurar projeto
```bash
export GCP_PROJECT_ID="seu-project-id"
gcloud config set project $GCP_PROJECT_ID
```

### 2. Executar deploy
```bash
./deploy.sh
```

### 3. Obter URL
```bash
gcloud run services describe sob-investigacao-api \
  --region us-central1 \
  --format 'value(status.url)'
```

---

## 🔧 Deploy Manual (Passo a Passo)

### 1. Build e Push da Imagem
```bash
PROJECT_ID="seu-project-id"

# Build da imagem
gcloud builds submit --tag gcr.io/$PROJECT_ID/sob-investigacao-api
```

### 2. Deploy no Cloud Run
```bash
gcloud run deploy sob-investigacao-api \
  --image gcr.io/$PROJECT_ID/sob-investigacao-api \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10
```

---

## 🔐 Configurar Permissões do Firestore

O Cloud Run usa **Application Default Credentials** automaticamente. Apenas configure as permissões:

### 1. Criar Service Account (se necessário)
```bash
gcloud iam service-accounts create sob-investigacao-sa \
  --display-name "Service Account para API"
```

### 2. Dar permissões ao Firestore
```bash
PROJECT_ID="seu-project-id"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:sob-investigacao-sa@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/datastore.user"
```

### 3. Usar no deploy
```bash
gcloud run deploy sob-investigacao-api \
  --image gcr.io/$PROJECT_ID/sob-investigacao-api \
  --service-account sob-investigacao-sa@$PROJECT_ID.iam.gserviceaccount.com \
  --region us-central1
```

---

## 📊 Comandos Úteis

### Ver logs
```bash
gcloud run services logs read sob-investigacao-api \
  --region us-central1 \
  --limit 50
```

### Atualizar serviço
```bash
gcloud run services update sob-investigacao-api \
  --region us-central1 \
  --memory 1Gi \
  --cpu 2
```

### Listar serviços
```bash
gcloud run services list --region us-central1
```

### Ver detalhes
```bash
gcloud run services describe sob-investigacao-api \
  --region us-central1
```

---

## 💰 Custos

Cloud Run cobra por:
- **Requisições**: $0.40 por milhão
- **Memória**: $0.0000025 por GB-segundo
- **CPU**: $0.00002400 por vCPU-segundo

**Plano gratuito inclui:**
- 2 milhões de requisições/mês
- 360.000 GB-segundos de memória
- 180.000 vCPU-segundos

---

## 🔍 Troubleshooting

### Erro: "Permission denied"
```bash
# Verificar permissões
gcloud projects get-iam-policy seu-project-id
```

### Erro: "Cannot connect to Firestore"
- Verificar se o projeto do Firestore é o mesmo do GCP
- Verificar se Application Default Credentials está configurado
- Verificar permissões do service account

### Erro: "Port already in use"
- Cloud Run define `PORT` automaticamente
- Verificar se `main.ts` usa `process.env.PORT`

---

## 📝 Variáveis de Ambiente

Se precisar adicionar variáveis de ambiente:

```bash
gcloud run services update sob-investigacao-api \
  --update-env-vars KEY1=value1,KEY2=value2 \
  --region us-central1
```

---

## 🎯 Próximos Passos

1. Configurar domínio customizado (opcional)
2. Configurar SSL/TLS
3. Configurar rate limiting
4. Configurar monitoring e alertas
5. Configurar CI/CD com Cloud Build
