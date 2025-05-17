-- Archivo SQL para la base de datos masimtaller_db
-- Generado para PostgreSQL

-- Configuración inicial
SET client_encoding = 'UTF8';
SET standard_conforming_strings = 'on';
SELECT pg_catalog.set_config('search_path', '', false);

-- Creación de la base de datos
CREATE DATABASE masimtaller_db
    WITH 
    TEMPLATE = template0
    ENCODING = 'UTF8'
    LOCALE_PROVIDER = libc
    LOCALE = 'es-MX';

\connect masimtaller_db

-- Funciones
CREATE OR REPLACE FUNCTION restrict_single_admin_secretary()
RETURNS TRIGGER AS $$
BEGIN
    -- Validar que solo haya un admin
    IF NEW.role = 'admin' THEN
        PERFORM 1 FROM users WHERE role = 'admin' AND id != NEW.id;
        IF FOUND THEN
            RAISE EXCEPTION 'Solo puede haber un usuario con rol admin';
        END IF;
    END IF;

    -- Validar que solo haya un secretary
    IF NEW.role = 'secretary' THEN
        PERFORM 1 FROM users WHERE role = 'secretary' AND id != NEW.id;
        IF FOUND THEN
            RAISE EXCEPTION 'Solo puede haber un usuario con rol secretary';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.notify_order_parts_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    part_name VARCHAR(100);
    admin_id VARCHAR(10);
    technician_id VARCHAR(10);
    notification_type VARCHAR(20);
    notification_message TEXT;
    notification_details JSONB;
    existing_notification RECORD;
    quantity_diff INTEGER;
BEGIN
    -- Obtener el nombre del repuesto
    SELECT name INTO part_name FROM parts WHERE id = NEW.part_id;
    -- Obtener el technician_id de la tabla orders
    SELECT o.technician_id INTO technician_id 
    FROM orders o 
    WHERE o.id = NEW.order_id;
    -- Obtener el ID del administrador
    SELECT id INTO admin_id FROM users WHERE role = 'admin' LIMIT 1;

    IF TG_OP = 'INSERT' THEN
        -- Verificar si ya existe una notificación pendiente para este part_id y order_id
        SELECT * INTO existing_notification
        FROM notifications
        WHERE order_id = NEW.order_id
          AND type = 'part_request'
          AND (details->>'part_id')::text = NEW.part_id
          AND status = 'Pendiente'
        LIMIT 1;

        IF NOT FOUND THEN
            notification_type := 'part_request';
            notification_message := format('Solicitud de repuesto: %s (%s)', part_name, NEW.quantity);
            notification_details := jsonb_build_object('part_id', NEW.part_id, 'quantity', NEW.quantity, 'price', NEW.price);
            INSERT INTO notifications (order_id, from_user_id, to_user_id, message, type, status, details, created_at)
            VALUES (NEW.order_id, NEW.requested_by, admin_id, notification_message, notification_type, 'Pendiente', notification_details, CURRENT_TIMESTAMP);
        END IF;

    ELSIF TG_OP = 'UPDATE' THEN
        -- Manejar cambio de estado
        IF NEW.status != OLD.status THEN
            IF NEW.status = 'Aprobado' THEN
                notification_type := 'part_approval';
                notification_message := format('Repuesto aprobado: %s (%s)', part_name, NEW.quantity);
                notification_details := jsonb_build_object('part_id', NEW.part_id, 'quantity', NEW.quantity, 'price', NEW.price, 'authorized_by', NEW.authorized_by);
                INSERT INTO notifications (order_id, from_user_id, to_user_id, message, type, status, details, created_at)
                VALUES (NEW.order_id, NEW.authorized_by, technician_id, notification_message, notification_type, 'Pendiente', notification_details, CURRENT_TIMESTAMP);
            ELSIF NEW.status = 'Rechazado' THEN
                notification_type := 'part_rejection';
                notification_message := format('Repuesto rechazado: %s (%s)', part_name, NEW.quantity);
                notification_details := jsonb_build_object('part_id', NEW.part_id, 'quantity', NEW.quantity, 'reason', NEW.note);
                INSERT INTO notifications (order_id, from_user_id, to_user_id, message, type, status, details, created_at)
                VALUES (NEW.order_id, NEW.authorized_by, technician_id, notification_message, notification_type, 'Pendiente', notification_details, CURRENT_TIMESTAMP);
            END IF;
        END IF;

        -- Manejar cambio de cantidad o precio
        IF NEW.quantity != OLD.quantity OR NEW.price != OLD.price THEN
            SELECT * INTO existing_notification
            FROM notifications
            WHERE order_id = NEW.order_id
              AND type = 'part_request'
              AND (details->>'part_id')::text = NEW.part_id
              AND status = 'Pendiente'
            ORDER BY created_at DESC
            LIMIT 1;

            IF FOUND THEN
                -- Actualizar notificación existente
                notification_message := format('Solicitud actualizada de repuesto: %s (%s)', part_name, NEW.quantity);
                notification_details := jsonb_build_object('part_id', NEW.part_id, 'quantity', NEW.quantity, 'price', NEW.price);
                UPDATE notifications
                SET message = notification_message,
                    details = notification_details,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = existing_notification.id;
            ELSE
                -- Crear nueva notificación si no hay una pendiente
                quantity_diff := NEW.quantity - OLD.quantity;
                notification_type := 'part_request';
                notification_message := format(
                    'Solicitud de %s %s adicional(es) para la orden %s',
                    ABS(quantity_diff),
                    part_name,
                    NEW.order_id
                );
                notification_details := jsonb_build_object('part_id', NEW.part_id, 'quantity', NEW.quantity, 'price', NEW.price, 'quantity_diff', quantity_diff);
                INSERT INTO notifications (order_id, from_user_id, to_user_id, message, type, status, details, created_at)
                VALUES (NEW.order_id, NEW.requested_by, admin_id, notification_message, notification_type, 'Pendiente', notification_details, CURRENT_TIMESTAMP);
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER order_parts_notification
AFTER INSERT OR UPDATE ON order_parts
FOR EACH ROW EXECUTE FUNCTION notify_order_parts_changes();

CREATE FUNCTION public.notify_order_status_changes() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    admin_id VARCHAR(10);
    secretary_id VARCHAR(10);
    notification_type VARCHAR(20);
    notification_message TEXT;
    details JSONB;
BEGIN
    SELECT id INTO admin_id FROM users WHERE role = 'admin' LIMIT 1;
    SELECT id INTO secretary_id FROM users WHERE role = 'secretary' LIMIT 1;

    IF NEW.status = 'Pendiente' AND OLD.status != 'Pendiente' THEN
        notification_type := 'closure_request';
        notification_message := format('Orden #%s enviada para aprobación', NEW.id);
        details := jsonb_build_object('order_id', NEW.id);
        INSERT INTO notifications (order_id, from_user_id, to_user_id, message, type, status, details, created_at)
        VALUES (NEW.id, NEW.technician_id, admin_id, notification_message, notification_type, 'Pendiente', details, CURRENT_TIMESTAMP);
    ELSIF NEW.status = 'Pendiente de Facturación' AND OLD.status != 'Pendiente de Facturación' THEN
        notification_type := 'invoice_complete';
        notification_message := format('Orden #%s lista para facturación', NEW.id);
        details := jsonb_build_object('order_id', NEW.id);
        INSERT INTO notifications (order_id, from_user_id, to_user_id, message, type, status, details, created_at)
        VALUES (NEW.id, admin_id, secretary_id, notification_message, notification_type, 'Pendiente', details, CURRENT_TIMESTAMP);
    END IF;
    RETURN NEW;
END;
$$;

-- Tablas y secuencias
CREATE TABLE public.users (
    id character varying(10) NOT NULL,
    first_name character varying(50) NOT NULL,
    last_name character varying(50) NOT NULL,
    email character varying(100) UNIQUE,
    password character varying(100) NOT NULL,
    role character varying(20) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT users_pkey PRIMARY KEY (id),
    CONSTRAINT users_role_check CHECK (role IN ('admin', 'technician', 'secretary', 'client'))
);

CREATE TABLE public.vehicles (
    economic_number character varying(10) NOT NULL,
    brand character varying(50) NOT NULL,
    model character varying(50) NOT NULL,
    year integer NOT NULL,
    mileage integer NOT NULL,
    vin character varying(50) NOT NULL,
    branch character varying(50) NOT NULL,
    plate character varying(20) NOT NULL,
    CONSTRAINT vehicles_pkey PRIMARY KEY (economic_number)
);

CREATE TABLE public.parts (
    id character varying(10) NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    price numeric(10,2) NOT NULL,
    quantity integer NOT NULL,
    image character varying(100),
    compatible_models text[],
    CONSTRAINT parts_pkey PRIMARY KEY (id)
);

CREATE SEQUENCE public.orders_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE TABLE public.orders (
    id character varying(10) NOT NULL,
    type character varying(50) NOT NULL,
    description text NOT NULL,
    initial_diagnosis text,
    tasks text,
    images text[],
    technician_id character varying(10) NOT NULL,
    vehicle_economic_number character varying(10) NOT NULL,
    status character varying(50) NOT NULL,
    created_at date NOT NULL,
    finalized_at date,
    updated_at timestamp without time zone,
    order_number character varying(20),
    CONSTRAINT orders_pkey PRIMARY KEY (id),
    CONSTRAINT orders_status_check CHECK (status IN ('En Proceso', 'Pendiente', 'Finalizado', 'Pendiente de Facturación', 'Facturado'))
);

CREATE SEQUENCE public.invoices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE TABLE public.invoices (
    id integer NOT NULL,
    order_id character varying(10) NOT NULL,
    invoice_number character varying(20),
    delivery_note_number character varying(20),
    issued_by character varying(10) NOT NULL,
    issued_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    total numeric(10,2),
    CONSTRAINT invoices_pkey PRIMARY KEY (id),
    CONSTRAINT invoices_order_id_key UNIQUE (order_id)
);

CREATE SEQUENCE public.notifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE TABLE public.notifications (
    id integer NOT NULL,
    order_id character varying(10) NOT NULL,
    from_user_id character varying(10) NOT NULL,
    to_user_id character varying(10) NOT NULL,
    message text NOT NULL,
    type character varying(20) NOT NULL,
    status character varying(20) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    details jsonb,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT notifications_pkey PRIMARY KEY (id),
    CONSTRAINT notifications_status_check CHECK (status IN ('Pendiente', 'Leída', 'Archivada')),
    CONSTRAINT notifications_type_check CHECK (type IN ('message', 'part_request', 'closure_request', 'part_approval', 'part_rejection', 'closure_approval', 'closure_rejection', 'client_update', 'invoice_complete', 'part_return_request', 'order_creation'))
);

CREATE SEQUENCE public.notification_attachments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE TABLE public.notification_attachments (
    id integer NOT NULL,
    notification_id integer NOT NULL,
    file_path character varying(100) NOT NULL,
    file_type character varying(20) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT notification_attachments_pkey PRIMARY KEY (id),
    CONSTRAINT notification_attachments_file_type_check CHECK (file_type IN ('image/jpeg', 'image/png', 'application/pdf'))
);

CREATE SEQUENCE public.order_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE TABLE public.order_history (
    id integer NOT NULL,
    order_id character varying(10) NOT NULL,
    description text NOT NULL,
    date timestamp without time zone NOT NULL,
    status character varying(50) NOT NULL,
    CONSTRAINT order_history_pkey PRIMARY KEY (id)
);

CREATE SEQUENCE public.order_parts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE TABLE public.order_parts (
    id integer NOT NULL,
    order_id character varying(10) NOT NULL,
    part_id character varying(10) NOT NULL,
    quantity integer NOT NULL,
    price numeric(10,2),
    status character varying(20) NOT NULL,
    requested_by character varying(10) NOT NULL,
    authorized_by character varying(10),
    CONSTRAINT order_parts_pkey PRIMARY KEY (id),
    CONSTRAINT order_parts_status_check CHECK (status IN ('Solicitado', 'Aprobado', 'Rechazado'))
);

-- Vista
CREATE VIEW public.conversations AS
    SELECT 
        n.order_id,
        o.vehicle_economic_number,
        o.status AS order_status,
        max(n.created_at) AS last_message_at,
        count(n.id) AS total_messages,
        count(CASE WHEN n.status = 'Pendiente' THEN 1 ELSE NULL END) AS unread_messages,
        string_agg(DISTINCT (u_from.first_name || ' ' || u_from.last_name), ', ') AS senders,
        string_agg(DISTINCT (u_to.first_name || ' ' || u_to.last_name), ', ') AS recipients
    FROM public.notifications n
    JOIN public.orders o ON n.order_id = o.id
    JOIN public.users u_from ON n.from_user_id = u_from.id
    JOIN public.users u_to ON n.to_user_id = u_to.id
    GROUP BY n.order_id, o.vehicle_economic_number, o.status;

-- Configuración de secuencias
ALTER TABLE public.invoices ALTER COLUMN id SET DEFAULT nextval('public.invoices_id_seq'::regclass);
ALTER TABLE public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);
ALTER TABLE public.notification_attachments ALTER COLUMN id SET DEFAULT nextval('public.notification_attachments_id_seq'::regclass);
ALTER TABLE public.order_history ALTER COLUMN id SET DEFAULT nextval('public.order_history_id_seq'::regclass);
ALTER TABLE public.order_parts ALTER COLUMN id SET DEFAULT nextval('public.order_parts_id_seq'::regclass);

ALTER SEQUENCE public.invoices_id_seq OWNED BY public.invoices.id;
ALTER SEQUENCE public.notifications_id_seq OWN pblic.notifications.id;
ALTER SEQUENCE public.notification_attachments_id_seq OWNED BY public.notification_attachments.id;
ALTER SEQUENCE public.order_history_id_seq OWNED BY public.order_history.id;
ALTER SEQUENCE public.order_parts_id_seq OWNED BY public.order_parts.id;

-- Índices
CREATE INDEX idx_notification_attachments_notification_id ON public.notification_attachments USING btree (notification_id);
CREATE INDEX idx_notifications_created_at ON public.notifications USING btree (created_at DESC);
CREATE INDEX idx_notifications_from_user_id ON public.notifications USING btree (from_user_id);
CREATE INDEX idx_notifications_order_id ON public.notifications USING btree (order_id);
CREATE INDEX idx_notifications_to_user_id ON public.notifications USING btree (to_user_id);

-- Claves foráneas
ALTER TABLE public.invoices
    ADD CONSTRAINT invoices_issued_by_fkey FOREIGN KEY (issued_by) REFERENCES public.users(id),
    ADD CONSTRAINT invoices_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);

ALTER TABLE public.notification_attachments
    ADD CONSTRAINT notification_attachments_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES public.notifications(id) ON DELETE CASCADE;

ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_from_user_id_fkey FOREIGN KEY (from_user_id) REFERENCES public.users(id),
    ADD CONSTRAINT notifications_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id),
    ADD CONSTRAINT notifications_to_user_id_fkey FOREIGN KEY (to_user_id) REFERENCES public.users(id);

ALTER TABLE public.order_history
    ADD CONSTRAINT order_history_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);

ALTER TABLE public.order_parts
    ADD CONSTRAINT order_parts_authorized_by_fkey FOREIGN KEY (authorized_by) REFERENCES public.users(id),
    ADD CONSTRAINT order_parts_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id),
    ADD CONSTRAINT order_parts_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.parts(id),
    ADD CONSTRAINT order_parts_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id);

ALTER TABLE public.orders
    ADD CONSTRAINT orders_technician_id_fkey FOREIGN KEY (technician_id) REFERENCES public.users(id),
    ADD CONSTRAINT orders_vehicle_economic_number_fkey FOREIGN KEY (vehicle_economic_number) REFERENCES public.vehicles(economic_number);

-- Triggers
CREATE TRIGGER order_parts_notification_trigger
    AFTER INSERT OR UPDATE OF status ON public.order_parts
    FOR EACH ROW
    EXECUTE FUNCTION public.notify_order_parts_changes();

CREATE TRIGGER order_status_notification_trigger
    AFTER UPDATE OF status ON public.orders
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION public.notify_order_status_changes();

-- Configuración de valores iniciales de secuencias
SELECT pg_catalog.setval('public.invoices_id_seq', 13, true);
SELECT pg_catalog.setval('public.notification_attachments_id_seq', 1, false);
SELECT pg_catalog.setval('public.notifications_id_seq', 76, true);
SELECT pg_catalog.setval('public.order_history_id_seq', 46, true);
SELECT pg_catalog.setval('public.order_parts_id_seq', 60, true);
SELECT pg_catalog.setval('public.orders_id_seq', 17, true);