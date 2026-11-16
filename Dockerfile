FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DATA_DIR=/app/data \
    HOST=0.0.0.0 \
    PORT=5050

# LibreOffice Writer and metric-compatible fonts power native PDF preview and PDF exports on Linux
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-writer \
    fontconfig \
    fonts-crosextra-caladea \
    fonts-crosextra-carlito \
    fonts-liberation \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \
    && printf '%s\n' \
      '<?xml version="1.0"?>' \
      '<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">' \
      '<fontconfig>' \
      '  <alias><family>Cambria</family><default><family>Caladea</family></default></alias>' \
      '  <alias><family>Calibri</family><default><family>Carlito</family></default></alias>' \
      '  <alias><family>Times New Roman</family><default><family>Liberation Serif</family></default></alias>' \
      '  <alias><family>Arial</family><default><family>Liberation Sans</family></default></alias>' \
      '</fontconfig>' > /etc/fonts/local.conf \
    && fc-cache -f

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY Base_Template.docx convert_to_pdf.py db.py resume_builder.py web_app.py ./
COPY templates ./templates
COPY static ./static

RUN mkdir -p /app/data

VOLUME ["/app/data"]

EXPOSE 5050

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5050/api/health', timeout=3)" || exit 1

CMD ["sh", "-c", "fc-cache -f >/dev/null 2>&1 || true; exec gunicorn -w 1 --threads 4 --timeout 120 -b 0.0.0.0:5050 web_app:app"]
