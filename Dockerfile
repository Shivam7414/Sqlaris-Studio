# Sqlaris Studio on PHP's built-in server. Works with docker build and podman build.
#
#     docker build -t sqlaris-studio .
#     docker run --rm -p 127.0.0.1:8765:8765 \
#         -e VIEWER_USERNAME=me -e VIEWER_PASSWORD=pick-one \
#         -e PGSQL_HOST=host.docker.internal -e PGSQL_PASSWORD=... \
#         sqlaris-studio
#
# Publish the port on 127.0.0.1 only, as above. See "Docker and Podman" in the README.

FROM php:8.4-cli-alpine

RUN apk add --no-cache libpq \
    && apk add --no-cache --virtual .build postgresql-dev \
    && docker-php-ext-install pdo_pgsql pdo_mysql \
    && apk del .build

WORKDIR /app
COPY . /app

# The example setup reads the servers from the environment. Mount your own
# config.php over it to group and colour databases.
RUN cp config.example.php config.php \
    && mkdir /data \
    && chown www-data:www-data /data \
    && chmod +x docker/entrypoint.sh

# The sidebar arrangement you make in the page is kept here.
ENV SQLARIS_LAYOUT=/data/layout.json
VOLUME /data

USER www-data
EXPOSE 8765
ENTRYPOINT ["/app/docker/entrypoint.sh"]
