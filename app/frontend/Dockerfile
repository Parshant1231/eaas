FROM nginxinc/nginx-unprivileged:stable-alpine
LABEL org.opencontainers.image.source="https://github.com/Parshant1231/eaas"
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html
EXPOSE 8080
