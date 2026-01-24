#!/bin/bash
set -e

# Configurações (ajuste conforme necessário)
PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
SERVICE_NAME="sob-investigacao-api"
REGION="us-central1"

# Verificar se o PROJECT_ID está configurado
if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "your-project-id" ]; then
  echo "❌ Erro: PROJECT_ID não configurado!"
  echo "Configure com: export GCP_PROJECT_ID=seu-project-id"
  echo "Ou configure o projeto padrão: gcloud config set project seu-project-id"
  exit 1
fi

echo "🚀 Deployando $SERVICE_NAME para GCP Cloud Run..."
echo "📋 Projeto: $PROJECT_ID"

# Habilitar APIs necessárias
echo "🔧 Habilitando APIs necessárias..."
gcloud services enable artifactregistry.googleapis.com --project=$PROJECT_ID 2>/dev/null || true
gcloud services enable run.googleapis.com --project=$PROJECT_ID 2>/dev/null || true
gcloud services enable cloudbuild.googleapis.com --project=$PROJECT_ID 2>/dev/null || true
gcloud services enable containerregistry.googleapis.com --project=$PROJECT_ID 2>/dev/null || true

# Build e push da imagem
echo "📦 Building Docker image..."
gcloud builds submit --tag gcr.io/$PROJECT_ID/$SERVICE_NAME --project=$PROJECT_ID

# Deploy no Cloud Run
echo "🚀 Deploying to Cloud Run..."
gcloud run deploy $SERVICE_NAME \
  --image gcr.io/$PROJECT_ID/$SERVICE_NAME \
  --platform managed \
  --region $REGION \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --timeout 300 \
  --min-instances 0 \
  --max-instances 10 \
  --project=$PROJECT_ID

echo "✅ Deploy concluído!"
echo "📋 Obtenha a URL com: gcloud run services describe $SERVICE_NAME --region $REGION --format 'value(status.url)'"
