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

-- Creating functions
CREATE FUNCTION public.create_order_part_notification(p_order_id character varying, p_part_id character varying, p_quantity integer, p_status character varying, p_price numeric, p_note text, p_requested_by character varying, p_authorized_by character varying) RETURNS void
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
BEGIN
    SELECT name INTO part_name FROM parts WHERE id = p_part_id;
    SELECT o.technician_id INTO technician_id FROM orders o WHERE o.id = p_order_id;
    IF p_authorized_by IS NOT NULL THEN
        admin_id := p_authorized_by;
    ELSE
        SELECT id INTO admin_id FROM users WHERE role = 'admin' LIMIT 1;
    END IF;

    IF p_status = 'Solicitado' THEN
        SELECT * INTO existing_notification
        FROM notifications
        WHERE order_id = p_order_id
          AND type = 'part_request'
          AND (details->>'part_id')::text = p_part_id::text
          AND status = 'Pendiente'
        LIMIT 1;

        IF NOT FOUND THEN
            notification_type := 'part_request';
            notification_message := format('Solicitud de repuesto: %s (%s)', part_name, p_quantity);
            notification_details := jsonb_build_object(
                'order_id', p_order_id,
                'part_id', p_part_id,
                'quantity', p_quantity,
                'price', p_price
            );
            INSERT INTO notifications (order_id, from_user_id, to_user_id, message, type, status, details, created_at)
            VALUES (p_order_id, p_requested_by, admin_id, notification_message, notification_type, 'Pendiente', notification_details, CURRENT_TIMESTAMP);
        END IF;

    ELSIF p_status = 'Aprobado' THEN
        notification_type := 'part_approval';
        notification_message := format('Repuesto aprobado: %s (%s)', part_name, p_quantity);
        notification_details := jsonb_build_object(
            'order_id', p_order_id,
            'part_id', p_part_id,
            'quantity', p_quantity,
            'price', p_price,
            'authorized_by', p_authorized_by
        );
        INSERT INTO notifications (order_id, from_user_id, to_user_id, message, type, status, details, created_at)
        VALUES (p_order_id, p_authorized_by, technician_id, notification_message, notification_type, 'Pendiente', notification_details, CURRENT_TIMESTAMP);

    ELSIF p_status = 'Rechazado' THEN
        IF p_note IS NULL THEN
            RAISE EXCEPTION 'El motivo de rechazo es obligatorio';
        END IF;
        notification_type := 'part_rejection';
        notification_message := format('Repuesto rechazado: %s (%s)', part_name, p_quantity);
        notification_details := jsonb_build_object(
            'order_id', p_order_id,
            'part_id', p_part_id,
            'quantity', p_quantity,
            'reason', p_note
        );
        INSERT INTO notifications (order_id, from_user_id, to_user_id, message, type, status, details, created_at)
        VALUES (p_order_id, p_authorized_by, technician_id, notification_message, notification_type, 'Pendiente', notification_details, CURRENT_TIMESTAMP);
    END IF;
END;
$$;

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
        INSERT INTO notifications (
            order_id, from_user_id, to_user_id, message, type, status, details, created_at
        )
        VALUES (
            NEW.id, NEW.technician_id, admin_id, notification_message, notification_type, 'Pendiente', details, CURRENT_TIMESTAMP
        );
    ELSIF NEW.status = 'Pendiente de Facturación' AND OLD.status != 'Pendiente de Facturación' THEN
        notification_type := 'invoice_complete';
        notification_message := format('Orden #%s lista para facturación', NEW.id);
        details := jsonb_build_object('order_id', NEW.id);
        INSERT INTO notifications (
            order_id, from_user_id, to_user_id, message, type, status, details, created_at
        )
        VALUES (
            NEW.id, admin_id, secretary_id, notification_message, notification_type, 'Pendiente', details, CURRENT_TIMESTAMP
        );
    END IF;
    RETURN NEW;
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

-- Crear función para el trigger
CREATE OR REPLACE FUNCTION public.notify_order_part_insert()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'Solicitado' THEN
        PERFORM create_order_part_notification(
            NEW.order_id,
            NEW.part_id,
            NEW.quantity,
            NEW.status,
            NEW.price,
            NULL, -- note (no se usa para Solicitado)
            NEW.requested_by,
            NULL  -- authorized_by (no se usa para Solicitado)
        );
    END IF;
    RETURN NEW;
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
CREATE TRIGGER check_single_admin_secretary BEFORE INSERT OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.restrict_single_admin_secretary();
CREATE TRIGGER order_status_notification_trigger AFTER UPDATE OF status ON public.orders FOR EACH ROW WHEN (old.status IS DISTINCT FROM new.status) EXECUTE FUNCTION public.notify_order_status_changes();
CREATE TRIGGER order_parts_notification_trigger AFTER INSERT ON public.order_parts FOR EACH ROW EXECUTE FUNCTION public.notify_order_part_insert();

-- Setting sequence values
SELECT pg_catalog.setval('public.invoices_id_seq', 13, true);
SELECT pg_catalog.setval('public.notification_attachments_id_seq', 1, false);
SELECT pg_catalog.setval('public.notifications_id_seq', 125, true);
SELECT pg_catalog.setval('public.order_history_id_seq', 46, true);
SELECT pg_catalog.setval('public.order_parts_id_seq', 94, true);
SELECT pg_catalog.setval('public.orders_id_seq', 23, true);