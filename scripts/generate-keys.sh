#!/usr/bin/env bash
# Generates RSA key pair for RS256 JWT signing/verification.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYS_DIR="${SCRIPT_DIR}/../keys"

mkdir -p "${KEYS_DIR}"

openssl genrsa -out "${KEYS_DIR}/private.pem" 2048
openssl rsa -in "${KEYS_DIR}/private.pem" -pubout -out "${KEYS_DIR}/public.pem"

echo "RSA key pair generated in ${KEYS_DIR}/"
echo "  private.pem — Auth Service only (signing)"
echo "  public.pem  — Other microservices (verification)"
