-- Database: masimtaller_db
-- Setting up database encoding and search path
SET client_encoding = 'UTF8';
SET standard_conforming_strings = 'on';
SELECT pg_catalog.set_config('search_path', '', false);

-- Creating the database
CREATE DATABASE masimtaller_db WITH TEMPLATE = template0 ENCODING = 'UTF8' LOCALE_PROVIDER = libc LOCALE = 'es-MX';

-- Connecting to the database
\connect masimtaller_db

-- Creating sequences
CREATE SEQUENCE public.invoices_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE public.notification_attachments_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE public.notifications_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE public.order_history_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE public.order_parts_id_seq AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
CREATE SEQUENCE public.orders_id_seq START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

-- Creating tables
CREATE TABLE public.users (
    id character varying(10) NOT NULL,
    first_name character varying(50) NOT NULL,
    last_name character varying(50) NOT NULL,
    password character varying(100) NOT NULL,
    role character varying(20) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    email character varying(100),
    CONSTRAINT users_role_check CHECK ((role)::text = ANY (ARRAY['admin'::text, 'technician'::text, 'secretary'::text, 'client'::text])),
    CONSTRAINT users_email_key UNIQUE (email),
    CONSTRAINT users_pkey PRIMARY KEY (id)
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
    quantity_reserved integer DEFAULT 0 NOT NULL,
    CONSTRAINT check_available_quantity CHECK ((quantity >= quantity_reserved)),
    CONSTRAINT parts_quantity_reserved_check CHECK ((quantity_reserved >= 0)),
    CONSTRAINT parts_pkey PRIMARY KEY (id)
);

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
    CONSTRAINT orders_status_check CHECK ((status)::text = ANY (ARRAY['En Proceso'::text, 'Pendiente'::text, 'Finalizado'::text, 'Pendiente de Facturación'::text, 'Facturado'::text])),
    CONSTRAINT orders_pkey PRIMARY KEY (id)
);

CREATE TABLE public.invoices (
    id integer NOT NULL,
    order_id character varying(10) NOT NULL,
    invoice_number character varying(20),
    delivery_note_number character varying(20),
    issued_by character varying(10) NOT NULL,
    issued_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    total numeric(10,2),
    CONSTRAINT invoices_order_id_key UNIQUE (order_id),
    CONSTRAINT invoices_pkey PRIMARY KEY (id)
);

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
    CONSTRAINT notifications_status_check CHECK ((status)::text = ANY (ARRAY['Pendiente'::text, 'Leída'::text, 'Archivada'::text])),
    CONSTRAINT notifications_type_check CHECK ((type)::text = ANY (ARRAY['message'::text, 'part_request'::text, 'closure_request'::text, 'part_approval'::text, 'part_rejection'::text, 'closure_approval'::text, 'closure_rejection'::text, 'client_update'::text, 'invoice_complete'::text, 'part_return_request'::text, 'order_creation'::text])),
    CONSTRAINT notifications_pkey PRIMARY KEY (id)
);

CREATE TABLE public.notification_attachments (
    id integer NOT NULL,
    notification_id integer NOT NULL,
    file_path character varying(100) NOT NULL,
    file_type character varying(20) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT notification_attachments_file_type_check CHECK ((file_type)::text = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'application/pdf'::text])),
    CONSTRAINT notification_attachments_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.notification_logs (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(50),
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.order_history (
    id integer NOT NULL,
    order_id character varying(10) NOT NULL,
    description text NOT NULL,
    date timestamp without time zone NOT NULL,
    status character varying(50) NOT NULL,
    CONSTRAINT order_history_pkey PRIMARY KEY (id)
);

CREATE TABLE public.order_parts (
    id integer NOT NULL,
    order_id character varying(10) NOT NULL,
    part_id character varying(10) NOT NULL,
    quantity integer NOT NULL,
    price numeric(10,2),
    status character varying(20) NOT NULL,
    requested_by character varying(10) NOT NULL,
    authorized_by character varying(10),
    note text,
    CONSTRAINT order_parts_status_check CHECK ((status)::text = ANY (ARRAY['Solicitado'::text, 'Aprobado'::text, 'Rechazado'::text, 'Devolución Solicitada'::text, 'Devolución Aprobada'::text, 'Devolución Rechazada'::text])),
    CONSTRAINT order_parts_pkey PRIMARY KEY (id)
);

-- Setting sequence ownership
ALTER SEQUENCE public.invoices_id_seq OWNED BY public.invoices.id;
ALTER SEQUENCE public.notification_attachments_id_seq OWNED BY public.notification_attachments.id;
ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;
ALTER SEQUENCE public.order_history_id_seq OWNED BY public.order_history.id;
ALTER SEQUENCE public.order_parts_id_seq OWNED BY public.order_parts.id;

-- Setting default values for sequences
ALTER TABLE ONLY public.invoices ALTER COLUMN id SET DEFAULT nextval('public.invoices_id_seq'::regclass);
ALTER TABLE ONLY public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);
ALTER TABLE ONLY public.order_history ALTER COLUMN id SET DEFAULT nextval('public.order_history_id_seq'::regclass);
ALTER TABLE ONLY public.order_parts ALTER COLUMN id SET DEFAULT nextval('public.order_parts_id_seq'::regclass);

-- Actualizar la función create_order_part_notification
CREATE OR REPLACE FUNCTION public.create_order_part_notification(
    p_order_id character varying,
    p_part_id character varying,
    p_quantity integer,
    p_status character varying,
    p_price numeric,
    p_note text,
    p_requested_by character varying,
    p_authorized_by character varying
) RETURNS void
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
    order_status VARCHAR(25);
BEGIN
    RAISE NOTICE 'Ejecutando create_order_part_notification para order_id: %, part_id: %, status: %, quantity: %', p_order_id, p_part_id, p_status, p_quantity;

    -- Obtener el estado de la orden
    SELECT status INTO order_status FROM orders WHERE id = p_order_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Orden con ID % no encontrada', p_order_id;
    END IF;

    -- Si la orden está Finalizada, omitir notificaciones y ajustes de quantity_reserved
    IF order_status = 'Finalizado' THEN
        RAISE NOTICE 'Orden % en estado Finalizado, omitiendo notificaciones y ajustes de quantity_reserved', p_order_id;
        RETURN;
    END IF;

    -- Obtener el nombre de la parte
    SELECT name INTO part_name FROM parts WHERE id = p_part_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Repuesto con ID % no encontrado', p_part_id;
    END IF;

    -- Obtener el ID del técnico de la orden
    SELECT o.technician_id INTO technician_id FROM orders o WHERE o.id = p_order_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Orden con ID % no encontrada', p_order_id;
    END IF;

    -- Determinar el ID del administrador
    IF p_authorized_by IS NOT NULL THEN
        admin_id := p_authorized_by;
    ELSE
        SELECT id INTO admin_id FROM users WHERE role = 'admin' LIMIT 1;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'No se encontró un usuario con rol admin';
        END IF;
    END IF;

    IF p_status = 'Solicitado' THEN
        -- Verificar si ya existe una notificación part_request pendiente
        SELECT * INTO existing_notification
        FROM notifications
        WHERE order_id = p_order_id
          AND type = 'part_request'
          AND (details->>'part_id')::text = p_part_id::text
          AND status = 'Pendiente'
        LIMIT 1;

        IF FOUND THEN
            notification_type := 'part_request';
            notification_message := format('Solicitud de repuesto: %s (%s)', part_name, p_quantity);
            notification_details := jsonb_build_object(
                'order_id', p_order_id,
                'part_id', p_part_id,
                'quantity', p_quantity,
                'price', p_price
            );
            RAISE NOTICE 'Actualizando notificación part_request para order_id: %, part_id: %, notification_id: %', p_order_id, p_part_id, existing_notification.id;
            UPDATE notifications
            SET
                message = notification_message,
                details = notification_details,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = existing_notification.id;
        ELSE
            notification_type := 'part_request';
            notification_message := format('Solicitud de repuesto: %s (%s)', part_name, p_quantity);
            notification_details := jsonb_build_object(
                'order_id', p_order_id,
                'part_id', p_part_id,
                'quantity', p_quantity,
                'price', p_price
            );
            RAISE NOTICE 'Insertando notificación part_request para order_id: %, part_id: %', p_order_id, p_part_id;
            INSERT INTO notifications (
                order_id,
                from_user_id,
                to_user_id,
                message,
                type,
                status,
                details,
                created_at,
                updated_at
            )
            VALUES (
                p_order_id,
                p_requested_by,
                admin_id,
                notification_message,
                notification_type,
                'Pendiente',
                notification_details,
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
            );
        END IF;

    ELSIF p_status = 'Aprobado' THEN
        SELECT * INTO existing_notification
        FROM notifications
        WHERE order_id = p_order_id
          AND type = 'part_request'
          AND (details->>'part_id')::text = p_part_id::text
        ORDER BY created_at DESC
        LIMIT 1;

        notification_type := 'part_approval';
        notification_message := format('Repuesto aprobado: %s (%s)', part_name, p_quantity);
        notification_details := jsonb_build_object(
            'order_id', p_order_id,
            'part_id', p_part_id,
            'quantity', p_quantity,
            'price', p_price,
            'authorized_by', p_authorized_by
        );

        IF FOUND THEN
            RAISE NOTICE 'Actualizando notificación a part_approval para order_id: %, part_id: %, notification_id: %', p_order_id, p_part_id, existing_notification.id;
            UPDATE notifications
            SET
                type = notification_type,
                message = notification_message,
                from_user_id = p_authorized_by,
                to_user_id = technician_id,
                status = 'Pendiente',
                details = notification_details,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = existing_notification.id;
        ELSE
            RAISE NOTICE 'Creando nueva notificación part_approval para order_id: %, part_id: %', p_order_id, p_part_id;
            INSERT INTO notifications (
                order_id,
                from_user_id,
                to_user_id,
                message,
                type,
                status,
                details,
                created_at,
                updated_at
            )
            VALUES (
                p_order_id,
                p_authorized_by,
                technician_id,
                notification_message,
                notification_type,
                'Pendiente',
                notification_details,
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
            );
        END IF;

        RAISE NOTICE 'Descontando quantity y quantity_reserved para part_id: %', p_part_id;
        UPDATE parts
        SET quantity = GREATEST(quantity - p_quantity, 0),
            quantity_reserved = GREATEST(quantity_reserved - p_quantity, 0)
        WHERE id = p_part_id;

    ELSIF p_status = 'Rechazado' THEN
        IF p_note IS NULL OR LENGTH(TRIM(p_note)) < 5 THEN
            RAISE EXCEPTION 'El motivo de rechazo es obligatorio y debe tener al menos 5 caracteres';
        END IF;
        SELECT * INTO existing_notification
        FROM notifications
        WHERE order_id = p_order_id
          AND type = 'part_request'
          AND (details->>'part_id')::text = p_part_id::text
        ORDER BY created_at DESC
        LIMIT 1;

        notification_type := 'part_rejection';
        notification_message := format('Repuesto rechazado: %s (%s)', part_name, p_quantity);
        notification_details := jsonb_build_object(
            'order_id', p_order_id,
            'part_id', p_part_id,
            'quantity', p_quantity,
            'note', p_note
        );

        IF FOUND THEN
            RAISE NOTICE 'Actualizando notificación a part_rejection para order_id: %, part_id: %, notification_id: %', p_order_id, p_part_id, existing_notification.id;
            UPDATE notifications
            SET
                type = notification_type,
                message = notification_message,
                from_user_id = p_authorized_by,
                to_user_id = technician_id,
                status = 'Pendiente',
                details = notification_details,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = existing_notification.id;
        ELSE
            RAISE NOTICE 'Creando nueva notificación part_rejection para order_id: %, part_id: %', p_order_id, p_part_id;
            INSERT INTO notifications (
                order_id,
                from_user_id,
                to_user_id,
                message,
                type,
                status,
                details,
                created_at,
                updated_at
            )
            VALUES (
                p_order_id,
                p_authorized_by,
                technician_id,
                notification_message,
                notification_type,
                'Pendiente',
                notification_details,
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
            );
        END IF;

        RAISE NOTICE 'Liberando quantity_reserved para part_id: %', p_part_id;
        UPDATE parts
        SET quantity_reserved = GREATEST(quantity_reserved - p_quantity, 0)
        WHERE id = p_part_id;

    ELSIF p_status = 'Devolución Solicitada' THEN
        SELECT * INTO existing_notification
        FROM notifications
        WHERE order_id = p_order_id
          AND type IN ('part_approval', 'part_return_request') 
          AND (details->>'part_id')::text = p_part_id::text
        LIMIT 1;

        notification_type := 'part_return_request';
        notification_message := format('Solicitud de devolución de %s (%s) para la orden #%s', part_name, p_quantity, p_order_id);
        notification_details := jsonb_build_object(
            'order_id', p_order_id,
            'part_id', p_part_id,
            'quantity', p_quantity
        );

        IF FOUND THEN
            RAISE NOTICE 'Actualizando notificación a part_return_request para order_id: %, part_id: %, notification_id: %', p_order_id, p_part_id, existing_notification.id;
            UPDATE notifications
            SET
                type = notification_type,
                message = notification_message,
                from_user_id = p_requested_by,
                to_user_id = admin_id,
                status = 'Pendiente',
                details = notification_details,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = existing_notification.id;
        ELSE
            RAISE NOTICE 'Creando nueva notificación part_return_request para order_id: %, part_id: %', p_order_id, p_part_id;
            INSERT INTO notifications (
                order_id,
                from_user_id,
                to_user_id,
                message,
                type,
                status,
                details,
                created_at,
                updated_at
            )
            VALUES (
                p_order_id,
                p_requested_by,
                admin_id,
                notification_message,
                notification_type,
                'Pendiente',
                notification_details,
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
            );
        END IF;

    ELSIF p_status = 'Devolución Aprobada' THEN
        SELECT * INTO existing_notification
        FROM notifications
        WHERE order_id = p_order_id
          AND type = 'part_return_request'
          AND (details->>'part_id')::text = p_part_id::text
        LIMIT 1;

        notification_type := 'part_return_request';
        notification_message := format('Devolución de %s (%s) aprobada para la orden #%s', part_name, p_quantity, p_order_id);
        notification_details := jsonb_build_object(
            'order_id', p_order_id,
            'part_id', p_part_id,
            'quantity', p_quantity,
            'authorized_by', p_authorized_by
        );

        IF FOUND THEN
            RAISE NOTICE 'Actualizando notificación a part_return_request para order_id: %, part_id: %, notification_id: %', p_order_id, p_part_id, existing_notification.id;
            UPDATE notifications
            SET
                type = notification_type,
                message = notification_message,
                from_user_id = p_authorized_by,
                to_user_id = technician_id,
                status = 'Pendiente',
                details = notification_details,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = existing_notification.id;
        ELSE
            RAISE NOTICE 'Creando nueva notificación part_return_request para order_id: %, part_id: %', p_order_id, p_part_id;
            INSERT INTO notifications (
                order_id,
                from_user_id,
                to_user_id,
                message,
                type,
                status,
                details,
                created_at,
                updated_at
            )
            VALUES (
                p_order_id,
                p_authorized_by,
                technician_id,
                notification_message,
                notification_type,
                'Pendiente',
                notification_details,
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
            );
        END IF;

    ELSIF p_status = 'Devolución Rechazada' THEN
        SELECT * INTO existing_notification
        FROM notifications
        WHERE order_id = p_order_id
          AND type = 'part_return_request'
          AND (details->>'part_id')::text = p_part_id::text
        LIMIT 1;

        notification_type := 'part_return_request';
        notification_message := format(
            'Devolución de %s (%s) rechazada para la orden #%s%s',
            part_name,
            p_quantity,
            p_order_id,
            CASE WHEN p_note IS NOT NULL AND TRIM(p_note) != '' THEN ': ' || p_note ELSE '' END
        );
        notification_details := jsonb_build_object(
            'order_id', p_order_id,
            'part_id', p_part_id,
            'quantity', p_quantity,
            'note', CASE WHEN p_note IS NOT NULL AND TRIM(p_note) != '' THEN p_note ELSE NULL END
        );

        IF FOUND THEN
            RAISE NOTICE 'Actualizando notificación a part_return_request para order_id: %, part_id: %, notification_id: %', p_order_id, p_part_id, existing_notification.id;
            UPDATE notifications
            SET
                type = notification_type,
                message = notification_message,
                from_user_id = p_authorized_by,
                to_user_id = technician_id,
                status = 'Pendiente',
                details = notification_details,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = existing_notification.id;
        ELSE
            RAISE NOTICE 'Creando nueva notificación part_return_request para order_id: %, part_id: %', p_order_id, p_part_id;
            INSERT INTO notifications (
                order_id,
                from_user_id,
                to_user_id,
                message,
                type,
                status,
                details,
                created_at,
                updated_at
            )
            VALUES (
                p_order_id,
                p_authorized_by,
                technician_id,
                notification_message,
                notification_type,
                'Pendiente',
                notification_details,
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
            );
        END IF;
    END IF;
END;
$$;

CREATE FUNCTION public.restrict_single_admin_secretary() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.role = 'admin' THEN
        PERFORM 1 FROM users WHERE role = 'admin' AND id != NEW.id;
        IF FOUND THEN
            RAISE EXCEPTION 'Solo puede haber un usuario con rol admin';
        END IF;
    END IF;

    IF NEW.role = 'secretary' THEN
        PERFORM 1 FROM users WHERE role = 'secretary' AND id != NEW.id;
        IF FOUND THEN
            RAISE EXCEPTION 'Solo puede haber un usuario con rol secretary';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- Función para el trigger de inserción en order_parts
CREATE OR REPLACE FUNCTION public.notify_order_part_insert()
RETURNS TRIGGER AS $$
BEGIN
    RAISE NOTICE 'Trigger notify_order_part_insert ejecutado para order_id: %, part_id: %, status: %', NEW.order_id, NEW.part_id, NEW.status;
    IF NEW.status = 'Solicitado' THEN
        PERFORM create_order_part_notification(
            NEW.order_id,
            NEW.part_id,
            NEW.quantity,
            NEW.status,
            NEW.price,
            NULL,
            NEW.requested_by,
            NULL
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Función para el trigger de actualización en order_parts
CREATE OR REPLACE FUNCTION public.notify_order_part_update()
RETURNS TRIGGER AS $$
BEGIN
    RAISE NOTICE 'Trigger notify_order_part_update ejecutado para order_id: %, part_id: %, old_status: %, new_status: %, old_quantity: %, new_quantity: %', 
        NEW.order_id, NEW.part_id, OLD.status, NEW.status, OLD.quantity, NEW.quantity;

    -- Verificar si el usuario que autoriza es administrador
    IF NEW.authorized_by IS NOT NULL THEN
        PERFORM 1 FROM users WHERE id = NEW.authorized_by AND role = 'admin';
        IF FOUND THEN
            -- Generar notificaciones solo para estados relevantes
            IF NEW.status IN ('Aprobado', 'Rechazado', 'Devolución Aprobada', 'Devolución Rechazada') 
               AND OLD.status != NEW.status THEN
                PERFORM create_order_part_notification(
                    NEW.order_id,
                    NEW.part_id,
                    NEW.quantity,
                    NEW.status,
                    NEW.price,
                    NEW.note,
                    NEW.requested_by,
                    NEW.authorized_by
                );
            END IF;
        END IF;
    END IF;

    -- Permitir notificaciones para solicitudes (no requieren admin)
    IF NEW.status = 'Solicitado' AND OLD.quantity != NEW.quantity THEN
        PERFORM create_order_part_notification(
            NEW.order_id,
            NEW.part_id,
            NEW.quantity,
            NEW.status,
            NEW.price,
            NEW.note,
            NEW.requested_by,
            NEW.authorized_by
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Nueva función para manejar notificaciones de cierre de órdenes
CREATE OR REPLACE FUNCTION public.create_order_closure_notification(
    p_order_id character varying,
    p_status character varying,
    p_note text,
    p_authorized_by character varying
) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
    admin_id VARCHAR(10);
    technician_id VARCHAR(10);
    notification_type VARCHAR(20);
    notification_message TEXT;
    notification_details JSONB;
    existing_notification RECORD;
BEGIN
    -- Obtener el ID del técnico de la orden
    SELECT o.technician_id INTO technician_id FROM orders o WHERE o.id = p_order_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Orden con ID % no encontrada', p_order_id;
    END IF;

    -- Determinar el ID del administrador
    IF p_authorized_by IS NOT NULL THEN
        admin_id := p_authorized_by;
    ELSE
        SELECT id INTO admin_id FROM users WHERE role = 'admin' LIMIT 1;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'No se encontró un usuario con rol admin';
        END IF;
    END IF;

    IF p_status = 'Pendiente' THEN
        -- Buscar notificación existente de tipo closure_request, closure_approval o closure_rejection
        SELECT * INTO existing_notification
        FROM notifications
        WHERE order_id = p_order_id
          AND type IN ('closure_request', 'closure_approval', 'closure_rejection')
        ORDER BY updated_at DESC
        LIMIT 1;

        IF FOUND THEN
            -- Actualizar la notificación existente a closure_request
            notification_type := 'closure_request';
            notification_message := format('Orden #%s pendiente de aprobación', p_order_id);
            notification_details := jsonb_build_object('order_id', p_order_id);
            UPDATE notifications
            SET
                type = notification_type,
                message = notification_message,
                from_user_id = technician_id,
                to_user_id = admin_id,
                status = 'Pendiente',
                details = notification_details,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = existing_notification.id;
            RAISE NOTICE 'Notificación existente actualizada a closure_request para order_id: %, notification_id: %', p_order_id, existing_notification.id;
        ELSE
            -- Crear nueva notificación para closure_request
            notification_type := 'closure_request';
            notification_message := format('Orden #%s pendiente de aprobación', p_order_id);
            notification_details := jsonb_build_object('order_id', p_order_id);
            INSERT INTO notifications (
                order_id,
                from_user_id,
                to_user_id,
                message,
                type,
                status,
                details,
                created_at,
                updated_at
            )
            VALUES (
                p_order_id,
                technician_id,
                admin_id,
                notification_message,
                notification_type,
                'Pendiente',
                notification_details,
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
            );
            RAISE NOTICE 'Nueva notificación closure_request creada para order_id: %', p_order_id;
        END IF;

    ELSIF p_status = 'Finalizado' THEN
        -- Buscar la notificación closure_request existente
        SELECT * INTO existing_notification
        FROM notifications
        WHERE order_id = p_order_id
          AND type = 'closure_request'
          AND status = 'Pendiente'
        LIMIT 1;

        IF FOUND THEN
            -- Actualizar la notificación existente a closure_approval
            notification_type := 'closure_approval';
            notification_message := format('Cierre aprobado para orden #%s', p_order_id);
            notification_details := jsonb_build_object(
                'order_id', p_order_id,
                'authorized_by', p_authorized_by
            );
            UPDATE notifications
            SET
                type = notification_type,
                message = notification_message,
                from_user_id = p_authorized_by,
                to_user_id = technician_id,
                status = 'Pendiente',
                details = notification_details,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = existing_notification.id;
            RAISE NOTICE 'Notificación actualizada a closure_approval para order_id: %, notification_id: %', p_order_id, existing_notification.id;
        END IF;

    ELSIF p_status = 'Rechazado' THEN
        IF p_note IS NULL THEN
            RAISE EXCEPTION 'El motivo de rechazo es obligatorio';
        END IF;
        -- Buscar la notificación closure_request existente
        SELECT * INTO existing_notification
        FROM notifications
        WHERE order_id = p_order_id
          AND type = 'closure_request'
          AND status = 'Pendiente'
        LIMIT 1;

        IF FOUND THEN
            -- Actualizar la notificación existente a closure_rejection
            notification_type := 'closure_rejection';
            notification_message := format('Cierre rechazado para orden #%s: %s', p_order_id, p_note);
            notification_details := jsonb_build_object(
                'order_id', p_order_id,
                'reason', p_note
            );
            UPDATE notifications
            SET
                type = notification_type,
                message = notification_message,
                from_user_id = p_authorized_by,
                to_user_id = technician_id,
                status = 'Pendiente',
                details = notification_details,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = existing_notification.id;
            RAISE NOTICE 'Notificación actualizada a closure_rejection para order_id: %, notification_id: %', p_order_id, existing_notification.id;
        END IF;
    END IF;
END;
$$;

-- Actualizar la función notify_order_status_changes para usar create_order_closure_notification
CREATE OR REPLACE FUNCTION public.notify_order_status_changes()
RETURNS TRIGGER AS $$
DECLARE
    admin_id VARCHAR(10);
    v_technician_id VARCHAR(10);
    vehicle_economic_number VARCHAR(10);
    branch VARCHAR(50);
BEGIN
    -- Obtener el ID del administrador
    SELECT id INTO admin_id FROM users WHERE role = 'admin' LIMIT 1;
    IF NOT FOUND THEN
        RAISE NOTICE 'No se encontró un usuario con rol admin';
    END IF;

    -- Obtener el ID del técnico
    SELECT technician_id INTO v_technician_id FROM orders WHERE id = NEW.id;
    IF NOT FOUND THEN
        RAISE NOTICE 'No se encontró técnico para la orden %', NEW.id;
    END IF;

    -- Obtener información del vehículo
    SELECT v.economic_number, v.branch 
    INTO vehicle_economic_number, branch
    FROM vehicles v
    JOIN orders o ON o.vehicle_economic_number = v.economic_number
    WHERE o.id = NEW.id;

    IF NEW.status = 'Pendiente' AND OLD.status != 'Pendiente' THEN
        PERFORM create_order_closure_notification(
            NEW.id,
            NEW.status,
            NULL,
            NULL
        );
    ELSIF NEW.status = 'Finalizado' AND OLD.status != 'Finalizado' THEN
        -- Solo generar notificación si el cambio es autorizado por un admin
        PERFORM 1 FROM order_history oh 
        JOIN users u ON oh.description LIKE '%' || u.id || '%' 
        WHERE oh.order_id = NEW.id AND u.role = 'admin' 
        AND oh.date >= CURRENT_TIMESTAMP - INTERVAL '1 minute';
        IF FOUND THEN
            PERFORM create_order_closure_notification(
                NEW.id,
                NEW.status,
                NULL,
                admin_id
            );
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Función para notificar cambios en invoices
CREATE OR REPLACE FUNCTION public.notify_invoice_changes()
RETURNS TRIGGER AS $$
DECLARE
  admin_id VARCHAR(10);
  secretary_id VARCHAR(10);
  existing_notification RECORD;
BEGIN
  BEGIN
    -- Obtener IDs de admin y secretary
    SELECT id INTO admin_id FROM users WHERE role = 'admin' LIMIT 1;
    SELECT id INTO secretary_id FROM users WHERE role = 'secretary' LIMIT 1;

    IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
      -- Actualizar el estado de la orden a Facturado
      UPDATE orders
      SET status = 'Facturado',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = NEW.order_id;

      -- Enviar notificación de canal
      PERFORM pg_notify(
        'invoice_updated',
        json_build_object(
          'id', NEW.id,
          'order_id', NEW.order_id,
          'invoice_number', NEW.invoice_number,
          'delivery_note_number', NEW.delivery_note_number,
          'issued_by', NEW.issued_by,
          'issued_at', NEW.issued_at,
          'total', NEW.total
        )::text
      );

      IF secretary_id IS NOT NULL THEN
        -- Buscar notificación invoice_complete existente
        SELECT * INTO existing_notification
        FROM notifications
        WHERE order_id = NEW.order_id
        AND type = 'invoice_complete'
        LIMIT 1;

        IF FOUND THEN
          -- Actualizar notificación existente
          UPDATE notifications
          SET
            message = format('Factura ingresada para la orden #%s', NEW.order_id),
            from_user_id = NEW.issued_by,
            to_user_id = admin_id,
            details = jsonb_build_object(
              'invoice_id', NEW.id,
              'invoice_number', NEW.invoice_number,
              'order_id', NEW.order_id
            ),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = existing_notification.id;
        ELSE
          -- Crear nueva notificación
          INSERT INTO notifications (
            order_id,
            from_user_id,
            to_user_id,
            message,
            type,
            status,
            details,
            created_at,
            updated_at
          )
          VALUES (
            NEW.order_id,
            NEW.issued_by,
            admin_id,
            format('Factura ingresada para la orden #%s', NEW.order_id),
            'invoice_complete',
            'Pendiente',
            jsonb_build_object(
              'invoice_id', NEW.id,
              'invoice_number', NEW.invoice_number,
              'order_id', NEW.order_id
            ),
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          );
        END IF;
      END IF;

    ELSIF (TG_OP = 'DELETE') THEN

      -- Enviar notificación de canal
      PERFORM pg_notify(
        'invoice_deleted',
        json_build_object(
          'id', OLD.id,
          'order_id', OLD.order_id
        )::text
      );

      IF secretary_id IS NOT NULL THEN
        -- Buscar notificación invoice_complete existente
        SELECT * INTO existing_notification
        FROM notifications
        WHERE order_id = OLD.order_id
          AND type = 'invoice_complete'
        LIMIT 1;

        IF FOUND THEN
          -- Actualizar notificación existente
          UPDATE notifications
          SET
            message = format('Orden #%s lista para facturación', OLD.order_id),
            from_user_id = admin_id,
            to_user_id = secretary_id,
            status = 'Pendiente',
            details = jsonb_build_object(
              'order_id', OLD.order_id,
              'vehicle_economic_number', (SELECT vehicle_economic_number FROM orders WHERE id = OLD.order_id),
              'branch', (SELECT branch FROM vehicles WHERE economic_number = (SELECT vehicle_economic_number FROM orders WHERE id = OLD.order_id))
            ),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = existing_notification.id;
        ELSE
          -- Crear nueva notificación
          INSERT INTO notifications (
            order_id,
            from_user_id,
            to_user_id,
            message,
            type,
            status,
            details,
            created_at,
            updated_at
          )
          VALUES (
            OLD.order_id,
            admin_id,
            secretary_id,
            format('Orden #%s lista para facturación', OLD.order_id),
            'invoice_complete',
            'Pendiente',
            jsonb_build_object(
              'order_id', OLD.order_id,
              'vehicle_economic_number', (SELECT vehicle_economic_number FROM orders WHERE id = OLD.order_id),
              'branch', (SELECT branch FROM vehicles WHERE economic_number = (SELECT vehicle_economic_number FROM orders WHERE id = OLD.order_id))
            ),
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          );
        END IF;
      END IF;
      RETURN OLD;
    END IF;
    RETURN NEW;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO notification_logs (event_type, error_message)
    VALUES (TG_OP, SQLERRM);
    RAISE NOTICE 'Error en notify_invoice_changes: %', SQLERRM;
    RETURN NULL;
  END;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.notify_order_part_delete()
RETURNS TRIGGER AS $$
DECLARE
  order_status VARCHAR(20);
BEGIN
  -- Obtener el estado de la orden
  SELECT status INTO order_status 
  FROM orders 
  WHERE id = OLD.order_id;

  IF order_status = 'Finalizado' THEN
    RAISE NOTICE 'Orden % en estado Finalizado, omitiendo notificaciones', OLD.order_id;
    RETURN OLD;
  END IF;

  -- Liberar quantity_reserved para órdenes no finalizadas
  IF OLD.status = 'Solicitado' THEN
    UPDATE parts
    SET quantity_reserved = GREATEST(quantity_reserved - OLD.quantity, 0)
    WHERE id = OLD.part_id;
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Creating view
CREATE VIEW public.conversations AS
 SELECT n.order_id,
    o.vehicle_economic_number,
    o.status AS order_status,
    max(n.created_at) AS last_message_at,
    count(n.id) AS total_messages,
    count(CASE WHEN n.status = 'Pendiente' THEN 1 ELSE NULL::integer END) AS unread_messages,
    string_agg(DISTINCT (u_from.first_name || ' ' || u_from.last_name), ', ') AS senders,
    string_agg(DISTINCT (u_to.first_name || ' ' || u_to.last_name), ', ') AS recipients
   FROM public.notifications n
     JOIN public.orders o ON (n.order_id = o.id)
     JOIN public.users u_from ON (n.from_user_id = u_from.id)
     JOIN public.users u_to ON (n.to_user_id = u_to.id)
  GROUP BY n.order_id, o.vehicle_economic_number, o.status;

-- Creating foreign key constraints
ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_issued_by_fkey FOREIGN KEY (issued_by) REFERENCES public.users(id);
ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);
ALTER TABLE ONLY public.notification_attachments
    ADD CONSTRAINT notification_attachments_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES public.notifications(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_from_user_id_fkey FOREIGN KEY (from_user_id) REFERENCES public.users(id);
ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);
ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_to_user_id_fkey FOREIGN KEY (to_user_id) REFERENCES public.users(id);
ALTER TABLE ONLY public.order_history
    ADD CONSTRAINT order_history_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);
ALTER TABLE ONLY public.order_parts
    ADD CONSTRAINT order_parts_authorized_by_fkey FOREIGN KEY (authorized_by) REFERENCES public.users(id);
ALTER TABLE ONLY public.order_parts
    ADD CONSTRAINT order_parts_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);
ALTER TABLE ONLY public.order_parts
    ADD CONSTRAINT order_parts_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.parts(id);
ALTER TABLE ONLY public.order_parts
    ADD CONSTRAINT order_parts_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id);
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_technician_id_fkey FOREIGN KEY (technician_id) REFERENCES public.users(id);
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_vehicle_economic_number_fkey FOREIGN KEY (vehicle_economic_number) REFERENCES public.vehicles(economic_number);

-- Creating indexes
CREATE INDEX idx_notification_attachments_notification_id ON public.notification_attachments USING btree (notification_id);
CREATE INDEX idx_notifications_created_at ON public.notifications USING btree (created_at DESC);
CREATE INDEX idx_notifications_from_user_id ON public.notifications USING btree (from_user_id);
CREATE INDEX idx_notifications_order_id ON public.notifications USING btree (order_id);
CREATE INDEX idx_notifications_order_id_type ON public.notifications USING btree (order_id, type, status);
CREATE INDEX idx_notifications_to_user_id ON public.notifications USING btree (to_user_id);
CREATE INDEX idx_order_parts_order_id ON public.order_parts USING btree (order_id);
CREATE INDEX idx_order_parts_order_id_part_id ON public.order_parts USING btree (order_id, part_id);
CREATE INDEX idx_order_parts_part_id ON public.order_parts USING btree (part_id);
CREATE INDEX idx_orders_id_technician ON public.orders USING btree (id, technician_id);
CREATE INDEX idx_parts_id ON public.parts USING btree (id);
CREATE INDEX idx_parts_quantity ON public.parts USING btree (id, quantity, quantity_reserved);

-- Creating triggers
DROP TRIGGER IF EXISTS order_parts_notification_trigger ON public.order_parts;
DROP TRIGGER IF EXISTS order_parts_update_notification_trigger ON public.order_parts;
DROP TRIGGER IF EXISTS invoice_changes_trigger ON public.invoices;
CREATE TRIGGER notify_order_part_delete AFTER DELETE ON order_parts FOR EACH ROW EXECUTE FUNCTION notify_order_part_delete();
CREATE TRIGGER check_single_admin_secretary BEFORE INSERT OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.restrict_single_admin_secretary();
CREATE TRIGGER order_parts_notification_trigger AFTER INSERT ON public.order_parts FOR EACH ROW EXECUTE FUNCTION public.notify_order_part_insert();
CREATE TRIGGER order_parts_update_notification_trigger AFTER UPDATE OF status, quantity ON public.order_parts FOR EACH ROW EXECUTE FUNCTION public.notify_order_part_update();
CREATE TRIGGER order_status_notification_trigger AFTER UPDATE OF status ON public.orders FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION public.notify_order_status_changes();
CREATE TRIGGER invoice_changes_trigger AFTER INSERT OR UPDATE OR DELETE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.notify_invoice_changes();
-- Setting sequence values
SELECT pg_catalog.setval('public.invoices_id_seq', 13, true);
SELECT pg_catalog.setval('public.notification_attachments_id_seq', 1, false);
SELECT pg_catalog.setval('public.notifications_id_seq', 125, true);
SELECT pg_catalog.setval('public.order_history_id_seq', 46, true);
SELECT pg_catalog.setval('public.order_parts_id_seq', 94, true);
SELECT pg_catalog.setval('public.orders_id_seq', 23, true);