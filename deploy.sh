#!/bin/bash
set -e

echo "=========================================="
echo "  Deploy Sob Investigacao API"
echo "=========================================="
echo ""

# Verificar se gcloud está instalado
if ! command -v gcloud &> /dev/null; then
  echo "❌ Erro: gcloud CLI não está instalado!"
  echo ""
  echo "Instale em: https://cloud.google.com/sdk/docs/install"
  exit 1
fi

echo "✓ gcloud CLI encontrado"

# Configurações
SERVICE_NAME="sob-investigacao-api"
REGION="us-central1"

# Obter PROJECT_ID
if [ -n "$GCP_PROJECT_ID" ]; then
  PROJECT_ID="$GCP_PROJECT_ID"
else
  PROJECT_ID=$(gcloud config get-value project 2>/dev/null || echo "")
fi

# Verificar se o PROJECT_ID está configurado
if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "your-project-id" ]; then
  echo "❌ Erro: PROJECT_ID não configurado!"
  echo ""
  echo "Configure com uma das opções:"
  echo "  export GCP_PROJECT_ID=seu-project-id"
  echo "  gcloud config set project seu-project-id"
  exit 1
fi

echo "✓ Projeto: $PROJECT_ID"
echo ""

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

echo ""
echo "=========================================="
echo "  ✅ Deploy concluído com sucesso!"
echo "=========================================="
echo ""

# Obter e mostrar a URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region $REGION --format 'value(status.url)' --project=$PROJECT_ID 2>/dev/null || echo "")
if [ -n "$SERVICE_URL" ]; then
  echo "URL da API: $SERVICE_URL"
  echo "Health check: $SERVICE_URL/api"
else
  echo "Para obter a URL:"
  echo "  gcloud run services describe $SERVICE_NAME --region $REGION --format 'value(status.url)'"
fi
echo ""
