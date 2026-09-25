# Deployment Guide for DocuPilot-AI

Follow these steps to deploy your DocuPilot-AI application to your specified stack:

## 1. Backend: Render Free Web Service (Docker)

Your project already has a `render.yaml` configured to deploy the backend from the `Dockerfile.api`. 

1. Go to [Render Dashboard](https://dashboard.render.com/).
2. Click **New** -> **Blueprint**.
3. Connect your GitHub repository: `Geetansh124/DocuPilot-AI`.
4. Render will automatically read the `render.yaml` and create a Web Service for `docupilot-api`.
5. **Environment Variables**: You will need to securely provide the following secrets in your Render Web Service dashboard under the "Environment" tab (since they are set to `sync: false` in `render.yaml`):
   - `FRONTEND_ORIGIN`: Wait to set this until you have your Vercel frontend URL (e.g., `https://your-frontend-url.vercel.app`).
   - `NVIDIA_API_KEY`: Your NVIDIA API key for LLMs.
   - `ALPHAVANTAGE_API_KEY`: Your AlphaVantage API key if used in the backend.
   - `AWS_ACCESS_KEY_ID`: Your AWS access key for accessing S3 and DynamoDB.
   - `AWS_SECRET_ACCESS_KEY`: Your AWS secret key.

## 2. Frontend: Vercel Free Tier (Next.js)

The frontend is a Next.js application located in the `/frontend` directory.

1. Go to [Vercel Dashboard](https://vercel.com/dashboard).
2. Click **Add New** -> **Project**.
3. Import your GitHub repository: `Geetansh124/DocuPilot-AI`.
4. **Configure Project**:
   - **Framework Preset**: Next.js
   - **Root Directory**: `frontend` (Important: ensure you select the `frontend` folder).
5. **Environment Variables**: Expand the "Environment Variables" section and add:
   - `NEXT_PUBLIC_API_URL`: Set this to your Render backend URL (e.g., `https://docupilot-api.onrender.com`).
6. Click **Deploy**.

## 3. Storage: AWS S3 & DynamoDB

Your backend code is already configured to use these. Just ensure the IAM User corresponding to the AWS Credentials provided in Render has the following permissions:
- `s3:PutObject`, `s3:GetObject`, `s3:ListBucket` for the bucket `docupilot-327514289233-us-east-1`.
- `dynamodb:PutItem`, `dynamodb:GetItem`, `dynamodb:Scan`, `dynamodb:Query`, `dynamodb:UpdateItem` for the table `docupilot-documents`.

## 4. Final Verification
1. Once Vercel deployment finishes, copy your frontend Vercel URL.
2. Go back to Render -> `docupilot-api` Web Service -> Environment.
3. Update `FRONTEND_ORIGIN` to your Vercel URL and save. Render will automatically redeploy the backend with the new CORS origin.
4. Your application should now be fully live!
