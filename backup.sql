--
-- PostgreSQL database dump
--

-- Dumped from database version 17.4
-- Dumped by pg_dump version 17.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: create_order_closure_notification(character varying, character varying, text, character varying); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.create_order_closure_notification(p_order_id character varying, p_status character varying, p_note text, p_authorized_by character varying) RETURNS void
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


ALTER FUNCTION public.create_order_closure_notification(p_order_id character varying, p_status character varying, p_note text, p_authorized_by character varying) OWNER TO postgres;

--
-- Name: create_order_part_notification(character varying, character varying, integer, character varying, text, character varying, character varying); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.create_order_part_notification(p_order_id character varying, p_part_id character varying, p_quantity integer, p_status character varying, p_note text, p_requested_by character varying, p_authorized_by character varying) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_technician_id VARCHAR;
    v_admin_id VARCHAR;
    v_part_name VARCHAR;
    v_message TEXT;
    v_notification_type VARCHAR;
    v_notification_id INTEGER;
BEGIN
    -- Obtener technician_id
    SELECT technician_id INTO v_technician_id
    FROM orders WHERE id = p_order_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Orden % no encontrada', p_order_id;
    END IF;
    -- Obtener admin_id
    SELECT id INTO v_admin_id
    FROM users WHERE role = 'admin' LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No se encontró un usuario administrador';
    END IF;
    -- Obtener nombre del repuesto
    SELECT name INTO v_part_name
    FROM parts WHERE id = p_part_id;
    IF NOT FOUND THEN
        v_part_name := 'Repuesto desconocido';
    END IF;
    -- Determinar tipo de notificación y mensaje
    IF p_status = 'Devolución Solicitada' THEN
        v_notification_type := 'part_return_request';
        v_message := format('Solicitud de devolución de %s (%s unidades) para la orden #%s', v_part_name, p_quantity, p_order_id);
        -- Crear o actualizar notificación para admin
        INSERT INTO notifications (
            order_id, from_user_id, to_user_id, message, type, status, details, created_at, updated_at
        )
        VALUES (
            p_order_id, p_requested_by, v_admin_id, v_message, v_notification_type, 'Pendiente',
            jsonb_build_object('part_id', p_part_id, 'quantity', p_quantity),
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        ON CONFLICT (order_id, type, status)
        DO UPDATE SET
            message = EXCLUDED.message,
            details = EXCLUDED.details,
            updated_at = CURRENT_TIMESTAMP;
    ELSIF p_status IN ('Devolución Aprobada', 'Devolución Rechazada') THEN
        v_notification_type := 'part_return_request';
        IF p_status = 'Devolución Aprobada' THEN
            v_message := format('Devolución de %s (%s unidades) aprobada para la orden #%s', v_part_name, p_quantity, p_order_id);
        ELSIF p_status = 'Devolución Rechazada' THEN
            IF p_note IS NULL THEN
                RAISE EXCEPTION 'El motivo de rechazo es obligatorio';
            END IF;
            v_message := format('Devolución de %s (%s unidades) rechazada para la orden #%s: %s', v_part_name, p_quantity, p_order_id, p_note);
        END IF;
        -- Actualizar notificación existente
        SELECT id INTO v_notification_id
        FROM notifications
        WHERE order_id = p_order_id
            AND type = 'part_return_request'
            AND status = 'Pendiente'
            AND (details->>'part_id')::text = p_part_id
        ORDER BY updated_at DESC LIMIT 1;
        IF NOT FOUND THEN
            -- Crear nueva notificación si no existe
            INSERT INTO notifications (
                order_id, from_user_id, to_user_id, message, type, status, details, created_at, updated_at
            )
            VALUES (
                p_order_id, p_authorized_by, v_technician_id, v_message, v_notification_type, 'Pendiente',
                jsonb_build_object('part_id', p_part_id, 'quantity', p_quantity, 'note', p_note),
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            );
        ELSE
            -- Actualizar notificación existente
            UPDATE notifications
            SET
                message = v_message,
                from_user_id = p_authorized_by,
                to_user_id = v_technician_id,
                status = 'Pendiente',
                details = jsonb_build_object('part_id', p_part_id, 'quantity', p_quantity, 'note', p_note),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = v_notification_id;
        END IF;
    END IF;
END;
$$;


ALTER FUNCTION public.create_order_part_notification(p_order_id character varying, p_part_id character varying, p_quantity integer, p_status character varying, p_note text, p_requested_by character varying, p_authorized_by character varying) OWNER TO postgres;

--
-- Name: create_order_part_notification(character varying, character varying, integer, character varying, numeric, text, character varying, character varying); Type: FUNCTION; Schema: public; Owner: postgres
--

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
    order_status VARCHAR(20);
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


ALTER FUNCTION public.create_order_part_notification(p_order_id character varying, p_part_id character varying, p_quantity integer, p_status character varying, p_price numeric, p_note text, p_requested_by character varying, p_authorized_by character varying) OWNER TO postgres;

--
-- Name: notify_invoice_changes(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.notify_invoice_changes() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  admin_id VARCHAR(10);
  secretary_id VARCHAR(10);
  existing_notification RECORD;
  order_status VARCHAR(50);
BEGIN
  BEGIN
    -- Obtener IDs de admin y secretary
    SELECT id INTO admin_id FROM users WHERE role = 'admin' LIMIT 1;
    SELECT id INTO secretary_id FROM users WHERE role = 'secretary' LIMIT 1;

    IF TG_OP = 'INSERT' THEN
      -- Actualizar el estado de la orden a Facturado
      UPDATE orders
      SET status = 'Facturado',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = NEW.order_id;

      -- Enviar notificación de canal
      PERFORM pg_notify(
        'invoice_complete',
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
            status = 'Pendiente',
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

    ELSIF TG_OP = 'UPDATE' THEN
      -- Verificar el estado de la orden
      SELECT status INTO order_status
      FROM orders
      WHERE id = NEW.order_id;

      IF NEW.invoice_number IS NOT NULL AND OLD.invoice_number IS NOT NULL THEN        
        -- Enviar notificación de canal
        PERFORM pg_notify(
          'invoice_complete',
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
              status = 'Pendiente',
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

      ELSIF NEW.invoice_number IS NULL AND OLD.invoice_number IS NOT NULL THEN
        PERFORM pg_notify(
          'invoice_complete',
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
      END IF;
    END IF;
    RETURN NEW;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO notification_logs (event_type, error_message)
    VALUES (TG_OP, SQLERRM);
    RAISE NOTICE 'Error en notify_invoice_changes: %', SQLERRM;
    RETURN NULL;
  END;
END;
$$;


ALTER FUNCTION public.notify_invoice_changes() OWNER TO postgres;

--
-- Name: notify_order_part_delete(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.notify_order_part_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.notify_order_part_delete() OWNER TO postgres;

--
-- Name: notify_order_part_insert(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.notify_order_part_insert() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.notify_order_part_insert() OWNER TO postgres;

--
-- Name: notify_order_part_update(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.notify_order_part_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.notify_order_part_update() OWNER TO postgres;

--
-- Name: notify_order_status_changes(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.notify_order_status_changes() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    admin_id VARCHAR(10);
    v_technician_id VARCHAR(10); -- Renombrado para evitar ambigüedad
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
$$;


ALTER FUNCTION public.notify_order_status_changes() OWNER TO postgres;

--
-- Name: restrict_single_admin_secretary(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.restrict_single_admin_secretary() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.restrict_single_admin_secretary() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: notifications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.notifications (
    id integer NOT NULL,
    order_id character varying(10),
    from_user_id character varying(10) NOT NULL,
    to_user_id character varying(10) NOT NULL,
    message text NOT NULL,
    type character varying(20) NOT NULL,
    status character varying(20) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    details jsonb,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT notifications_status_check CHECK (((status)::text = ANY (ARRAY['Pendiente'::text, 'Leída'::text, 'Archivada'::text]))),
    CONSTRAINT notifications_type_check CHECK (((type)::text = ANY (ARRAY['message'::text, 'part_request'::text, 'closure_request'::text, 'part_approval'::text, 'part_rejection'::text, 'closure_approval'::text, 'closure_rejection'::text, 'client_update'::text, 'invoice_complete'::text, 'part_return_request'::text, 'order_creation'::text, 'direct_message'::text])))
);


ALTER TABLE public.notifications OWNER TO postgres;

--
-- Name: orders; Type: TABLE; Schema: public; Owner: postgres
--

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
    CONSTRAINT orders_status_check CHECK (((status)::text = ANY (ARRAY[('En Proceso'::character varying)::text, ('Pendiente'::character varying)::text, ('Finalizado'::character varying)::text, ('Pendiente de Facturación'::character varying)::text, ('Facturado'::character varying)::text])))
);


ALTER TABLE public.orders OWNER TO postgres;

--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id character varying(10) NOT NULL,
    first_name character varying(50) NOT NULL,
    last_name character varying(50) NOT NULL,
    password character varying(100) NOT NULL,
    role character varying(20) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    email character varying(100),
    CONSTRAINT users_role_check CHECK (((role)::text = ANY (ARRAY[('admin'::character varying)::text, ('technician'::character varying)::text, ('secretary'::character varying)::text, ('client'::character varying)::text])))
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: conversations; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.conversations AS
 SELECT COALESCE(n.order_id, 'DIRECT'::character varying) AS conversation_id,
    o.vehicle_economic_number,
    o.status AS order_status,
    max(n.created_at) AS last_message_at,
    count(n.id) AS total_messages,
    count(n.id) FILTER (WHERE (((n.status)::text = 'Pendiente'::text) AND ((n.to_user_id)::text = (u.id)::text))) AS unread_messages,
    string_agg(DISTINCT (((u_from.first_name)::text || ' '::text) || (u_from.last_name)::text), ', '::text) AS senders,
    string_agg(DISTINCT (((u_to.first_name)::text || ' '::text) || (u_to.last_name)::text), ', '::text) AS recipients
   FROM ((((public.notifications n
     LEFT JOIN public.orders o ON (((n.order_id)::text = (o.id)::text)))
     LEFT JOIN public.users u_from ON (((n.from_user_id)::text = (u_from.id)::text)))
     LEFT JOIN public.users u_to ON (((n.to_user_id)::text = (u_to.id)::text)))
     LEFT JOIN public.users u ON ((((u.id)::text = (n.from_user_id)::text) OR ((u.id)::text = (n.to_user_id)::text))))
  WHERE ((n.type)::text = ANY ((ARRAY['message'::character varying, 'direct_message'::character varying, 'part_request'::character varying, 'closure_request'::character varying, 'part_approval'::character varying, 'part_rejection'::character varying, 'closure_approval'::character varying, 'closure_rejection'::character varying, 'client_update'::character varying, 'invoice_complete'::character varying, 'part_return_request'::character varying, 'order_creation'::character varying])::text[]))
  GROUP BY COALESCE(n.order_id, 'DIRECT'::character varying), o.vehicle_economic_number, o.status, u.id
 HAVING (count(n.id) > 0);


ALTER VIEW public.conversations OWNER TO postgres;

--
-- Name: invoices; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.invoices (
    id integer NOT NULL,
    order_id character varying(10) NOT NULL,
    invoice_number character varying(20),
    delivery_note_number character varying(20),
    issued_by character varying(10),
    issued_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    total numeric(10,2)
);


ALTER TABLE public.invoices OWNER TO postgres;

--
-- Name: invoices_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.invoices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.invoices_id_seq OWNER TO postgres;

--
-- Name: invoices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.invoices_id_seq OWNED BY public.invoices.id;


--
-- Name: notification_attachments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.notification_attachments (
    id integer NOT NULL,
    notification_id integer NOT NULL,
    file_path character varying(100) NOT NULL,
    file_type character varying(20) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT notification_attachments_file_type_check CHECK (((file_type)::text = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'application/pdf'::text])))
);


ALTER TABLE public.notification_attachments OWNER TO postgres;

--
-- Name: notification_attachments_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.notification_attachments ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.notification_attachments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: notification_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.notification_logs (
    id integer NOT NULL,
    event_type character varying(50),
    error_message text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.notification_logs OWNER TO postgres;

--
-- Name: notification_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.notification_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.notification_logs_id_seq OWNER TO postgres;

--
-- Name: notification_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.notification_logs_id_seq OWNED BY public.notification_logs.id;


--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.notifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.notifications_id_seq OWNER TO postgres;

--
-- Name: notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;


--
-- Name: order_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.order_history (
    id integer NOT NULL,
    order_id character varying(10) NOT NULL,
    description text NOT NULL,
    date timestamp without time zone NOT NULL,
    status character varying(50) NOT NULL
);


ALTER TABLE public.order_history OWNER TO postgres;

--
-- Name: order_history_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.order_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.order_history_id_seq OWNER TO postgres;

--
-- Name: order_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.order_history_id_seq OWNED BY public.order_history.id;


--
-- Name: order_parts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.order_parts (
    id integer NOT NULL,
    order_id character varying(10) NOT NULL,
    part_id character varying(10) NOT NULL,
    quantity integer NOT NULL,
    price numeric(10,2),
    status character varying(25) NOT NULL,
    requested_by character varying(10) NOT NULL,
    authorized_by character varying(10),
    note text,
    CONSTRAINT order_parts_status_check CHECK (((status)::text = ANY (ARRAY[('Solicitado'::character varying)::text, ('Aprobado'::character varying)::text, ('Rechazado'::character varying)::text, ('Devolución Solicitada'::character varying)::text, ('Devolución Aprobada'::character varying)::text, ('Devolución Rechazada'::character varying)::text])))
);


ALTER TABLE public.order_parts OWNER TO postgres;

--
-- Name: order_parts_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.order_parts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.order_parts_id_seq OWNER TO postgres;

--
-- Name: order_parts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.order_parts_id_seq OWNED BY public.order_parts.id;


--
-- Name: orders_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.orders_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.orders_id_seq OWNER TO postgres;

--
-- Name: parts; Type: TABLE; Schema: public; Owner: postgres
--

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
    CONSTRAINT parts_quantity_reserved_check CHECK ((quantity_reserved >= 0))
);


ALTER TABLE public.parts OWNER TO postgres;

--
-- Name: vehicles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vehicles (
    economic_number character varying(10) NOT NULL,
    brand character varying(50) NOT NULL,
    model character varying(50) NOT NULL,
    year integer NOT NULL,
    mileage integer NOT NULL,
    vin character varying(50) NOT NULL,
    branch character varying(50) NOT NULL,
    plate character varying(20) NOT NULL
);


ALTER TABLE public.vehicles OWNER TO postgres;

--
-- Name: invoices id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoices ALTER COLUMN id SET DEFAULT nextval('public.invoices_id_seq'::regclass);


--
-- Name: notification_logs id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notification_logs ALTER COLUMN id SET DEFAULT nextval('public.notification_logs_id_seq'::regclass);


--
-- Name: notifications id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);


--
-- Name: order_history id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_history ALTER COLUMN id SET DEFAULT nextval('public.order_history_id_seq'::regclass);


--
-- Name: order_parts id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_parts ALTER COLUMN id SET DEFAULT nextval('public.order_parts_id_seq'::regclass);


--
-- Data for Name: invoices; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.invoices (id, order_id, invoice_number, delivery_note_number, issued_by, issued_at, total) FROM stdin;
15	023	\N	ALB-123	U001	2025-05-22 11:59:53.846	\N
16	029	\N	ALB-9876	U001	2025-05-23 20:00:28.638	\N
17	028	TEST-321	ALB-999	U003	2025-05-26 16:36:35.837671	75.00
\.


--
-- Data for Name: notification_attachments; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.notification_attachments (id, notification_id, file_path, file_type, created_at) FROM stdin;
\.


--
-- Data for Name: notification_logs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.notification_logs (id, event_type, error_message, created_at) FROM stdin;
1	DELETE	el nuevo registro para la relación «notifications» viola la restricción «check» «notifications_type_check»	2025-05-26 03:23:04.764114
2	UPDATE	el nuevo registro para la relación «notifications» viola la restricción «check» «notifications_type_check»	2025-05-26 03:28:34.59346
3	UPDATE	el nuevo registro para la relación «notifications» viola la restricción «check» «notifications_type_check»	2025-05-26 03:58:13.490336
4	UPDATE	el nuevo registro para la relación «notifications» viola la restricción «check» «notifications_type_check»	2025-05-26 05:40:39.398411
5	UPDATE	el nuevo registro para la relación «notifications» viola la restricción «check» «notifications_type_check»	2025-05-26 05:43:22.395325
6	UPDATE	el nuevo registro para la relación «notifications» viola la restricción «check» «notifications_type_check»	2025-05-26 05:43:33.15671
7	UPDATE	el nuevo registro para la relación «notifications» viola la restricción «check» «notifications_type_check»	2025-05-26 05:46:22.008132
8	UPDATE	el nuevo registro para la relación «notifications» viola la restricción «check» «notifications_type_check»	2025-05-26 05:46:32.969456
9	UPDATE	el valor nulo en la columna «from_user_id» de la relación «notifications» viola la restricción de no nulo	2025-05-26 06:02:52.641557
10	UPDATE	el valor nulo en la columna «from_user_id» de la relación «notifications» viola la restricción de no nulo	2025-05-26 06:06:22.12684
11	UPDATE	el valor nulo en la columna «from_user_id» de la relación «notifications» viola la restricción de no nulo	2025-05-26 06:23:42.664617
12	UPDATE	el valor nulo en la columna «from_user_id» de la relación «notifications» viola la restricción de no nulo	2025-05-26 06:26:42.056995
13	UPDATE	el valor nulo en la columna «from_user_id» de la relación «notifications» viola la restricción de no nulo	2025-05-26 06:33:11.3974
14	UPDATE	el valor nulo en la columna «from_user_id» de la relación «notifications» viola la restricción de no nulo	2025-05-26 14:41:25.669572
15	UPDATE	el valor nulo en la columna «from_user_id» de la relación «notifications» viola la restricción de no nulo	2025-05-26 14:50:53.704739
16	UPDATE	el valor nulo en la columna «from_user_id» de la relación «notifications» viola la restricción de no nulo	2025-05-26 15:00:16.912755
17	UPDATE	el valor nulo en la columna «from_user_id» de la relación «notifications» viola la restricción de no nulo	2025-05-26 15:10:11.968264
\.


--
-- Data for Name: notifications; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.notifications (id, order_id, from_user_id, to_user_id, message, type, status, created_at, details, updated_at) FROM stdin;
90	023	U002	U001	Nueva orden #023 creada por el técnico Technician User	order_creation	Leída	2025-05-15 21:26:33.475	{"description": "Orden de prueba, esta llegara hasta la fase de facturación, con pruebas para solicitar repuesto, solicitar finalización del servicio.", "vehicle_economic_number": "2782"}	2025-05-18 23:24:36.185
261	\N	U001	U002	test	direct_message	Leída	2025-05-27 02:35:08.881	\N	2025-05-27 04:28:16.944
265	\N	U001	U002	oi	direct_message	Leída	2025-05-27 02:54:23.951	\N	2025-05-27 04:28:16.999
266	029	U001	U002	oi order test	message	Leída	2025-05-27 02:54:36.151	\N	2025-05-27 04:28:26.71
277	029	U002	U001	mensaje	message	Pendiente	2025-05-27 04:29:03.686	\N	2025-05-27 04:29:03.76248
278	\N	U002	U001	oi	direct_message	Leída	2025-05-27 04:29:19.019	\N	2025-05-27 04:50:43.551
279	\N	U001	U002	test 2	direct_message	Leída	2025-05-27 04:50:56.43	\N	2025-05-27 04:51:09.741
280	029	U002	U001	Solicitud de repuesto: Bujías (2)	part_request	Pendiente	2025-05-27 06:12:15.609209	{"price": 80.00, "part_id": "P003", "order_id": "029", "quantity": 2}	2025-05-27 06:12:15.609209
246	\N	U003	U001	Una prueba mas de mensajeria Secretaria	direct_message	Leída	2025-05-26 18:43:43.285	\N	2025-05-26 19:00:46.257
241	\N	U003	U001	Prueba inicial de mensajería directa	direct_message	Leída	2025-05-26 14:37:01.099	\N	2025-05-26 18:30:43.012
245	028	U003	U001	Factura ingresada para la orden #028	invoice_complete	Leída	2025-05-26 16:14:22.672341	{"order_id": "028", "invoice_id": 17, "invoice_number": "TEST-321"}	2025-05-26 18:30:43.068
135	028	U002	U001	Nueva orden #028 creada por el técnico Técnico Gomez	order_creation	Leída	2025-05-20 23:12:16.148	{"description": "Prueba", "vehicle_economic_number": "3409"}	2025-05-21 00:10:49.013
251	\N	U003	U001	Enviando mensaje...	direct_message	Leída	2025-05-26 22:16:38.306	\N	2025-05-26 22:27:25.497
144	023	U001	U002	Repuesto aprobado: Filtro de Aceite (2)	part_approval	Leída	2025-05-21 18:46:29.152624	{"price": 100.00, "part_id": "P001", "order_id": "023", "quantity": 2, "authorized_by": "U001"}	2025-05-21 18:48:54.003457
146	023	U001	U002	Hola tecnico, prueba.	message	Leída	2025-05-21 18:51:55.291	\N	2025-05-21 18:51:55.397119
187	028	U001	U002	Repuesto aprobado: Filtro de Aceite (2)	part_approval	Leída	2025-05-22 14:42:56.468107	{"price": 100.00, "part_id": "P001", "order_id": "028", "quantity": 2, "authorized_by": "U001"}	2025-05-22 14:50:51.657373
192	028	U001	U002	Orden #028 aprobada	closure_approval	Leída	2025-05-22 16:43:25.158004	{"order_id": "028"}	2025-05-22 16:56:44.302
194	023	U001	U002	Orden #023 aprobada	closure_approval	Leída	2025-05-22 19:17:34.421564	{"order_id": "023"}	2025-05-22 20:10:03.357
200	029	U002	U001	Nueva orden #029 creada por el técnico Técnico Gomez	order_creation	Leída	2025-05-22 22:23:54.603	{"description": "Prueba 3 de repuestos", "vehicle_economic_number": "3076"}	2025-05-22 22:23:54.553319
249	029	U001	U002	Por que fue rechazado?	message	Leída	2025-05-26 22:13:44.31	\N	2025-05-27 01:23:15.301
252	029	U001	U002	Mensaje de prueba en orden #029	message	Leída	2025-05-26 23:53:08.659	\N	2025-05-27 01:23:15.368
253	\N	U001	U002	Prueba mensaje directo tecnico	direct_message	Leída	2025-05-27 00:15:07.017	\N	2025-05-27 01:23:15.387
256	\N	U002	U001	Prueba de mensajeria tecnico -> admin	direct_message	Leída	2025-05-27 02:04:15.087	\N	2025-05-27 02:05:15.078
257	029	U002	U001	Prueba interna de orden	message	Leída	2025-05-27 02:04:37.934	\N	2025-05-27 02:05:27.674
258	\N	U001	U002	respuesta en tiempo real Direct	direct_message	Leída	2025-05-27 02:08:42.852	\N	2025-05-27 02:08:53.742
259	029	U002	U001	respuesta en tiempo real para la orden.	message	Leída	2025-05-27 02:09:20.93	\N	2025-05-27 02:09:27.431
250	\N	U001	U003	Prueba secretaria, mensaje en tiempo real	direct_message	Leída	2025-05-26 22:15:16.95	\N	2025-05-27 02:44:15.744
260	\N	U001	U003	Test	direct_message	Leída	2025-05-27 02:35:02.602	\N	2025-05-27 02:44:15.776
262	\N	U003	U001	ok, mensajes implementados.	direct_message	Leída	2025-05-27 02:44:44.596	\N	2025-05-27 02:47:20.192
248	\N	U001	U004	Tesst	direct_message	Leída	2025-05-26 21:14:34.3	\N	2025-05-27 03:11:43.645
264	\N	U001	U004	oi	direct_message	Leída	2025-05-27 02:54:16.414	\N	2025-05-27 03:11:43.681
267	\N	U004	U001	Hola admin	direct_message	Leída	2025-05-27 03:12:04.827	\N	2025-05-27 03:18:01.189
268	\N	U001	U004	Hola cliente	direct_message	Leída	2025-05-27 03:18:13.68	\N	2025-05-27 03:18:50.067
269	\N	U004	U001	Mensaje en tiempo real, prueba	direct_message	Leída	2025-05-27 03:25:19.635	\N	2025-05-27 03:25:35.016
270	\N	U001	U004	prueba 2, mensaje en tiempo real	direct_message	Leída	2025-05-27 03:26:06.478	\N	2025-05-27 03:26:49.179
271	\N	U004	U001	Hola nuevamente	direct_message	Leída	2025-05-27 03:35:10.275	\N	2025-05-27 03:35:10.441
272	\N	U001	U004	Perfecto, sincronizacion en tiempo real	direct_message	Leída	2025-05-27 03:35:25.262	\N	2025-05-27 03:35:56.421
263	\N	U001	U003	oi	direct_message	Leída	2025-05-27 02:54:05.783	\N	2025-05-27 03:36:43.087
273	\N	U003	U001	prueba sec --> admin	direct_message	Leída	2025-05-27 03:45:23.979	\N	2025-05-27 03:45:25.7
274	\N	U001	U003	prueba admin --> sec	direct_message	Leída	2025-05-27 03:45:36.856	\N	2025-05-27 03:45:39.314
275	\N	U001	U003	hola prueba	direct_message	Leída	2025-05-27 04:00:36.084	\N	2025-05-27 04:00:40.161
276	\N	U003	U001	prueba de regreso	direct_message	Leída	2025-05-27 04:00:49.871	\N	2025-05-27 04:00:50.694
\.


--
-- Data for Name: order_history; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.order_history (id, order_id, description, date, status) FROM stdin;
59	023	Orden rechazada: test rechazo notificacion	2025-05-22 18:18:15.784	En Proceso
60	023	Solicitud de cierre enviada. Repuestos rechazados eliminados.	2025-05-22 18:29:26.615	Pendiente
61	023	Orden aprobada por administrador	2025-05-22 19:06:50.443	Finalizado
62	023	Solicitud de cierre enviada. Repuestos rechazados eliminados.	2025-05-22 19:17:34.487	Pendiente
63	023	Orden rechazada: Prueba notición duplicada	2025-05-22 19:18:27.95	En Proceso
64	023	Solicitud de cierre enviada. Repuestos rechazados eliminados.	2025-05-22 19:19:18.413	Pendiente
65	023	Solicitud de cierre enviada. Repuestos rechazados eliminados.	2025-05-22 19:21:33.91	Pendiente
66	023	Solicitud de cierre enviada. Repuestos rechazados eliminados.	2025-05-22 19:31:51.08	Pendiente
67	023	Solicitud de cierre enviada. Repuestos rechazados eliminados.	2025-05-22 19:52:28.614	Pendiente
68	023	Solicitud de cierre enviada. Repuestos rechazados eliminados.	2025-05-22 19:54:44.791	Pendiente
69	023	Solicitud de cierre enviada. Repuestos rechazados eliminados.	2025-05-22 20:08:19.56	Pendiente
70	023	Orden aprobada por administrador	2025-05-22 20:10:03.354	Finalizado
\.


--
-- Data for Name: order_parts; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.order_parts (id, order_id, part_id, quantity, price, status, requested_by, authorized_by, note) FROM stdin;
109	023	P001	2	100.00	Aprobado	U002	U001	\N
125	028	P001	1	75.00	Aprobado	U002	U001	\N
139	029	P003	2	80.00	Solicitado	U002	\N	\N
\.


--
-- Data for Name: orders; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.orders (id, type, description, initial_diagnosis, tasks, images, technician_id, vehicle_economic_number, status, created_at, finalized_at, updated_at, order_number) FROM stdin;
028	Mantenimiento	se pasara la orden a estado de solicitud de facturacion para pruebas.	teníamos problemas con la lógica de actualizacion, de orden: parts, edited, delete parts.	1. Actualizar orden. Ok\r\n2. Actualizacion/eliminación de imagen. Ok\r\n3. Reenderizado de datos. Ok\r\n4. Agregar repuestos. Ok\r\n5. Eliminar repuestos. Ok\r\n6. Editar repuestos (cant, precio). Ok\r\n7. Paso a facturacion.	{/uploads/1747793536048-truck.jpg}	U002	3409	Facturado	2025-05-20	2025-05-22	2025-05-26 16:36:35.859	PED-1111
023	Reparación	Orden de prueba, esta llegara hasta la fase de facturación, con pruebas para solicitar repuesto, solicitar finalización del servicio.	Prueba inicial para verificar errores.\r\nTest de creación ok, vamos a realizar update a la orden.\r\nModelo Crud para el technico casi listo.	1. Crear orden con repuesto. (Ok, se crea doble notificación de repuesto ---> Verificar)\r\n2. Actualizar algún campo de la orden, remover repuesto existente, agregar un nuevo repuesto y agregar foto. (Ok, revisar notas del cuaderno)\r\n2.1 Verificar actualización de cantidad de repuestos en la db. \r\n2.2 Notificaciones duplicadas. (ok, corregido)\r\n2.3 Verificar ultima actualizacion en order -> columna update_at (Ok, corregido)	{/uploads/1747355570413-truck-road.jpg}	U002	2782	Finalizado	2025-05-15	2025-05-22	2025-05-22 20:10:03.230387	PED-321
029	Reparación	Prueba 3 de repuestos	Crear repuestos y editarlos	1. soliciar repuestos\r\n2. actualizar orden.	{/uploads/1748136096713-mechanic.jpg}	U002	3076	En Proceso	2025-05-22	\N	2025-05-27 00:17:41.757371	PED-6789
\.


--
-- Data for Name: parts; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.parts (id, name, description, price, quantity, image, compatible_models, quantity_reserved) FROM stdin;
P002	Pastillas de Freno	Pastillas de freno delanteras	300.00	20	/uploads/1746732274491-Pastilllas_de_freno-removebg-preview.png	{"816 SEMILONG"}	0
P004	Batería	Batería de 12V	1200.00	20	/uploads/1746732304697-Bateria_12V-removebg-preview.png	{"ELF 500 E5","616 LONG HIBRIDO"}	0
P001	Filtro de Aceite	Filtro de aceite para motor	100.00	27	/uploads/1746679808704-Filtro_de_aceite-removebg-preview.png	{"ELF 500 E5","ELF 300","816 SEMILONG"}	0
P003	Bujías	Bujías de encendido	80.00	20	/uploads/1746732285275-Bujia_de_encendido-removebg-preview.png	{"ELF 300","ELF 800 FORWARD","816 SEMILONG"}	2
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (id, first_name, last_name, password, role, created_at, email) FROM stdin;
U001	Admin	User	$2b$10$GyF/jgiXe5VaBiK485.lTOLCZaPITb1JIQMNSdnQq5KaJuqMHano6	admin	2025-04-11 10:44:12.802356	halejandrogt@hotmail.com
U004	Client	User	$2b$10$jSqoc2.X.e.tZTezVecm5.morSVcJcO2I1xHoXoUluo6fIkETLPEu	client	2025-04-11 10:44:12.802356	alejandro.gomezt.businnes@gmail.com
U002	Técnico	Gomez	$2b$10$90IwDOXq5XZ.0j5Uid0akelpgiYdCQ3HtZOwM4vGB8lf3sHocOFc6	technician	2025-04-11 10:44:12.802356	alejogomezt2000@gmail.com
U003	Secretary	User	$2b$10$LUT6Zuy3UapmfikiRjvCHeiWlIR3K0MsPs4ktZ3tkyeuR8TwnPvfS	secretary	2025-04-11 10:44:12.802356	alejandro.gomezt@uqvirtual.edu.co
\.


--
-- Data for Name: vehicles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.vehicles (economic_number, brand, model, year, mileage, vin, branch, plate) FROM stdin;
2780	ISUZU	ELF 500 E5	2016	0	JAAN1R759G7902471	SALTILLO	ER3187B
2876	ISUZU	ELF 300	2016	0	JAANMR858G7500947	SALTILLO	ER3188B
2983	FORD	TRANSIT	2016	0	WFORS5GP1GTA84792	SALTILLO	LF71797
3098	ISUZU	ELF 500 E5	2018	0	JANN1R750J7902317	SALTILLO	ER3189B
3143	ISUZU	ELF 800 FORWARD	2020	0	3MGFRR343LM000035	SALTILLO	LD80608
3183	ISUZU	ELF 300	2019	0	JAANMR858L7500084	SALTILLO	LG42237
3185	ISUZU	ELF 300	2019	0	JAANMR855L7500236	SALTILLO	LG42242
3187	ISUZU	ELF 300	2019	0	JAANMR851L7500363	SALTILLO	LG42244
3412	ISUZU	ELF 800 FORWARD	2019	0	3MGFRR345LM000070	SALTILLO	LD88990
3431	ISUZU	ELF 300	2019	0	JAANMR85XL7500622	SALTILLO	LG42219
3142	ISUZU	ELF 800 FORWARD	2020	0	3MGFRR341LM00034	SALTILLO	LD42178
4001	HINO	616 LONG HIBRIDO	2022	0	JHHCNS3F3NK001274	SALTILLO	28J346
3429	ISUZU	ELF 500 E5	2020	165391	PENDIENTE	TORREON	AWAIT
4184	HINO	816 SEMILONG	2023	92952	PENDIENTE	TORREON	AWAIT
3945	ISUZU	ELF 300	2022	49291	PENDIENTE	TORREON	AWAIT
4221	HINO	816 SEMILONG	2023	78124	PENDIENTE	TORREON	AWAIT
4152	HINO	816 SEMILONG	2023	72523	PENDIENTE	TORREON	AWAIT
4155	HINO	816 SEMILONG	2023	102018	PENDIENTE	TORREON	AWAIT
4154	HINO	816 SEMILONG	2023	124533	PENDIENTE	TORREON	AWAIT
3436	ISUZU	ELF 500 E5	2020	0	PENDIENTE	TORREON	AWAIT
3430	ISUZU	ELF 500 E5	2020	255626	PENDIENTE	TORREON	AWAIT
3410	ISUZU	ELF 800 FORWARD	2020	297531	PENDIENTE	TORREON	AWAIT
3414	ISUZU	ELF 300	2020	101748	PENDIENTE	TORREON	AWAIT
3867	HINO	616 SEMILONG	2022	35145	PENDIENTE	TORREON	AWAIT
2918	HINO	1018 G	2017	329392	PENDIENTE	TORREON	AWAIT
3415	ISUZU	ELF 300	2020	80424	PENDIENTE	TORREON	AWAIT
3184	ISUZU	ELF 800 FORWARD	2020	222185	PENDIENTE	TORREON	AWAIT
3411	ISUZU	ELF 300	2020	110002	PENDIENTE	TORREON	AWAIT
1780	HINO	616 SEMILONG	2014	270354	PENDIENTE	TORREON	AWAIT
3831	HINO	616 LONG HIBRIDO	2022	55761	PENDIENTE	TORREON	AWAIT
3186	ISUZU	ELF 300	2020	106842	PENDIENTE	TORREON	AWAIT
3413	ISUZU	ELF 300	2020	89503	PENDIENTE	TORREON	AWAIT
3925	HINO	1018 G	2022	115330	PENDIENTE	TORREON	AWAIT
3060	ISUZU	ELF 500 E5	2020	211230	JHHCNS3F0NK001247	TORREON	AWAIT
3422	ISUZU	ELF 800 FORWARD	2020	246755	JAANMR859L7500028	GUADALUPE	AWAIT
3830	HINO	616 LONG HIBRIDO	2022	39858	PENDIENTE	GUADALUPE	LD251300
4158	HINO	816 SEMILONG	2020	116385	JHHTES0F0PK003104	GUADALUPE	AWAIT
4182	HINO	816 SEMILONG	2020	38397	PENDIENTE	GUADALUPE	LF91284
3215	ISUZU	ELF 300	114310	0	JAANMR857L7500366	GUADALUPE	AWAIT
3280	ISUZU	ELF 300	2020	110620	JAANMR854L7500227	GUADALUPE	AWAIT
3421	ISUZU	ELF 800 FORWARD	2020	261570	PENDIENTE	GUADALUPE	LD92749
4335	ISUZU	ELF 300	2020	143920	JAANMR857L7500514	GUADALUPE	AWAIT
2800	ISUZU	ELF 300	2016	0	PENDIENTE	GUADALUPE	AWAIT
3304	ISUZU	ELF 300	2020	115987	JAANMR851J7500053	GUADALUPE	AWAIT
3216	ISUZU	ELF 300	2020	79642	JAANMR854L7500227	GUADALUPE	AWAIT
3866	HINO	616 SEMILONG	2022	87670	JAANMR854L7500230	GUADALUPE	AWAIT
3283	ISUZU	ELF 300	2020	115000	JAANMR853G7500791	GUADALUPE	AWAIT
3144	ISUZU	ELF 800 FORWARD	2020	242604	JAANMR859L7500059	GUADALUPE	AWAIT
3843	HINO	616 SEMILONG	2022	84320	JAANMR854J7500029	GUADALUPE	AWAIT
2766	ISUZU	ELF 300	2020	0	PENDIENTE	GUADALUPE	AWAIT
3135	ISUZU	ELF 300	2020	0	PENDIENTE	GUADALUPE	AWAIT
2497	MERCEDES	SPLINTER	2015	0	PENDIENTE	GUADALUPE	AWAIT
2787	ISUZU	ELF 300	2016	220478	PENDIENTE	GUADALUPE	RP5722A
3211	ISUZU	ELF 300	2020	0	PENDIENTE	GUADALUPE	LG41667
2799	ISUZU	ELF 300	2016	186576	PENDIENTE	GUADALUPE	RF5253A
2496	MERCEDES	SPLINTER	2015	0	PENDIENTE	GUADALUPE	AWAIT
2486	MERCEDES	SPLINTER	2015	0	PENDIENTE	GUADALUPE	RP5703
3427	ISUZU	ELF 800 FORWARD	2020	179887	PENDIENTE	GUADALUPE	LD92750
3070	ISUZU	ELF 500 E5	2018	188790	PENDIENTE	GUADALUPE	PJ5620A
4181	HINO	816 SEMILONG	2023	95000	PENDIENTE	GUADALUPE	LF91775
4101	ISUZU	ELF 800 FORWARD	2022	0	PENDIENTE	GUADALUPE	LF64154
2937	ISUZU	ELF 300	2020	0	PENDIENTE	GUADALUPE	AWAIT
3278	ISUZU	ELF 300	2018	0	PENDIENTE	GUADALUPE	AWAIT
3145	ISUZU	ELF 800 FORWARD	2020	321000	PENDIENTE	GUADALUPE	AWAIT
2845	ISUZU	ELF 300	2020	110076	PENDIENTE	MONTERREY	RP5705
2957	ISUZU	ELF 300	2020	113752	PENDIENTE	MONTERREY	AWAIT
2961	ISUZU	ELF 300	2020	177520	JAANMR853L7500459	MONTERREY	AWAIT
2962	ISUZU	ELF 300	2020	87870	PENDIENTE	MONTERREY	RP5730
3137	ISUZU	ELF 300	2020	88458	PENDIENTE	MONTERREY	LG42203
3138	ISUZU	ELF 300	2020	97024	PENDIENTE	MONTERREY	LG4220A
3210	ISUZU	ELF 300	2020	66321	JAANMR852J7500062	MONTERREY	LG41666
3213	ISUZU	ELF 300	2020	84212	PENDIENTE	MONTERREY	AWAIT
3217	ISUZU	ELF 300	2020	96040	PENDIENTE	MONTERREY	LG41673
3277	ISUZU	ELF 300	2020	134126	PENDIENTE	MONTERREY	LD92719
3282	ISUZU	ELF 300	2020	66702	PENDIENTE	MONTERREY	AWAIT
3311	ISUZU	ELF 300	2020	97540	PENDIENTE	MONTERREY	AWAIT
3312	ISUZU	ELF 300	2020	35654	PENDIENTE	MONTERREY	AWAIT
4134	HINO	616 SEMILONG	2022	72000	PENDIENTE	MONTERREY	AWAIT
4135	HINO	616 SEMILONG	2023	15394	PENDIENTE	MONTERREY	LE18493
4174	HINO	816 SEMILONG	2023	47495	PENDIENTE	MONTERREY	AWAIT
2939	ISUZU	ELF 300	2018	0	JAANMR852L7500484	MONTERREY	AWAIT
3212	ISUZU	ELF 300	2020	74124	PENDIENTE	MONTERREY	AWAIT
3136	ISUZU	ELF 300	2020	95902	PENDIENTE	MONTERREY	LG42192
2959	ISUZU	ELF 300	2018	0	PENDIENTE	MONTERREY	RP5728A
2938	ISUZU	ELF 300	2020	134813	PENDIENTE	MONTERREY	AWAIT
4176	HINO	816 SEMILONG	2022	77000	PENDIENTE	MONTERREY	AWAIT
2929	ISUZU	ELF 500 E5	2017	291754	JAANMR853L7500120	GUADALUPE	AWAIT
3134	ISUZU	ELF 300	2020	121124	PENDIENTE	MONTERREY	AWAIT
2958	ISUZU	ELF 300	2018	0	PENDIENTE	MONTERREY	AWAIT
3076	ISUZU	ELF 300	2020	887	PENDIENTE	MONTERREY	AWAIT
3139	ISUZU	ELF 300	2018	120000	PENDIENTE	MONTERREY	AWAIT
3829	ISUZU	ELF 300	2020	0	PENDIENTE	MONTERREY	AWAIT
3117	ISUZU	ELF 500 E5	2018	279750	JAANMR855J7500038	GUADALUPE	AWAIT
2782	ISUZU	ELF 300	2016	123	PENDIENTE	TORREON	AWAIT
3409	ISUZU	ELF 300	2019	34500	JAANMR857L7500240	SALTILLO	LD88998
\.


--
-- Name: invoices_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.invoices_id_seq', 17, true);


--
-- Name: notification_attachments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.notification_attachments_id_seq', 1, false);


--
-- Name: notification_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.notification_logs_id_seq', 17, true);


--
-- Name: notifications_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.notifications_id_seq', 280, true);


--
-- Name: order_history_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.order_history_id_seq', 70, true);


--
-- Name: order_parts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.order_parts_id_seq', 139, true);


--
-- Name: orders_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.orders_id_seq', 29, true);


--
-- Name: invoices invoices_order_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_order_id_key UNIQUE (order_id);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: notification_attachments notification_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notification_attachments
    ADD CONSTRAINT notification_attachments_pkey PRIMARY KEY (id);


--
-- Name: notification_logs notification_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notification_logs
    ADD CONSTRAINT notification_logs_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: order_history order_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_history
    ADD CONSTRAINT order_history_pkey PRIMARY KEY (id);


--
-- Name: order_parts order_parts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_parts
    ADD CONSTRAINT order_parts_pkey PRIMARY KEY (id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: parts parts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.parts
    ADD CONSTRAINT parts_pkey PRIMARY KEY (id);


--
-- Name: order_parts unique_order_part; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_parts
    ADD CONSTRAINT unique_order_part UNIQUE (order_id, part_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: vehicles vehicles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_pkey PRIMARY KEY (economic_number);


--
-- Name: idx_notification_attachments_notification_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_notification_attachments_notification_id ON public.notification_attachments USING btree (notification_id);


--
-- Name: idx_notifications_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_notifications_created_at ON public.notifications USING btree (created_at DESC);


--
-- Name: idx_notifications_from_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_notifications_from_user_id ON public.notifications USING btree (from_user_id);


--
-- Name: idx_notifications_order_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_notifications_order_id ON public.notifications USING btree (order_id);


--
-- Name: idx_notifications_order_id_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_notifications_order_id_type ON public.notifications USING btree (order_id, type, status);


--
-- Name: idx_notifications_to_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_notifications_to_user_id ON public.notifications USING btree (to_user_id);


--
-- Name: idx_order_parts_order_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_order_parts_order_id ON public.order_parts USING btree (order_id);


--
-- Name: idx_order_parts_order_id_part_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_order_parts_order_id_part_id ON public.order_parts USING btree (order_id, part_id);


--
-- Name: idx_order_parts_part_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_order_parts_part_id ON public.order_parts USING btree (part_id);


--
-- Name: idx_orders_id_technician; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_orders_id_technician ON public.orders USING btree (id, technician_id);


--
-- Name: idx_parts_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_parts_id ON public.parts USING btree (id);


--
-- Name: idx_parts_quantity; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_parts_quantity ON public.parts USING btree (id, quantity, quantity_reserved);


--
-- Name: users check_single_admin_secretary; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER check_single_admin_secretary BEFORE INSERT OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.restrict_single_admin_secretary();


--
-- Name: invoices invoice_changes_trigger; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER invoice_changes_trigger AFTER INSERT OR DELETE OR UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.notify_invoice_changes();


--
-- Name: order_parts notify_order_part_delete; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER notify_order_part_delete AFTER DELETE ON public.order_parts FOR EACH ROW EXECUTE FUNCTION public.notify_order_part_delete();


--
-- Name: order_parts order_parts_notification_trigger; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER order_parts_notification_trigger AFTER INSERT ON public.order_parts FOR EACH ROW EXECUTE FUNCTION public.notify_order_part_insert();


--
-- Name: order_parts order_parts_update_notification_trigger; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER order_parts_update_notification_trigger AFTER UPDATE OF status, quantity ON public.order_parts FOR EACH ROW EXECUTE FUNCTION public.notify_order_part_update();


--
-- Name: orders order_status_notification_trigger; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER order_status_notification_trigger AFTER UPDATE OF status ON public.orders FOR EACH ROW WHEN (((old.status)::text IS DISTINCT FROM (new.status)::text)) EXECUTE FUNCTION public.notify_order_status_changes();


--
-- Name: order_parts fk_order_parts_authorized_by; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_parts
    ADD CONSTRAINT fk_order_parts_authorized_by FOREIGN KEY (authorized_by) REFERENCES public.users(id);


--
-- Name: order_parts fk_order_parts_order_id; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_parts
    ADD CONSTRAINT fk_order_parts_order_id FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: order_parts fk_order_parts_part_id; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_parts
    ADD CONSTRAINT fk_order_parts_part_id FOREIGN KEY (part_id) REFERENCES public.parts(id);


--
-- Name: order_parts fk_order_parts_requested_by; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_parts
    ADD CONSTRAINT fk_order_parts_requested_by FOREIGN KEY (requested_by) REFERENCES public.users(id);


--
-- Name: invoices invoices_issued_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_issued_by_fkey FOREIGN KEY (issued_by) REFERENCES public.users(id);


--
-- Name: invoices invoices_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: notification_attachments notification_attachments_notification_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notification_attachments
    ADD CONSTRAINT notification_attachments_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES public.notifications(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_from_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_from_user_id_fkey FOREIGN KEY (from_user_id) REFERENCES public.users(id);


--
-- Name: notifications notifications_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: notifications notifications_to_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_to_user_id_fkey FOREIGN KEY (to_user_id) REFERENCES public.users(id);


--
-- Name: order_history order_history_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_history
    ADD CONSTRAINT order_history_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: order_parts order_parts_authorized_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_parts
    ADD CONSTRAINT order_parts_authorized_by_fkey FOREIGN KEY (authorized_by) REFERENCES public.users(id);


--
-- Name: order_parts order_parts_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_parts
    ADD CONSTRAINT order_parts_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id);


--
-- Name: order_parts order_parts_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_parts
    ADD CONSTRAINT order_parts_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.parts(id);


--
-- Name: order_parts order_parts_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.order_parts
    ADD CONSTRAINT order_parts_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id);


--
-- Name: orders orders_technician_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_technician_id_fkey FOREIGN KEY (technician_id) REFERENCES public.users(id);


--
-- Name: orders orders_vehicle_economic_number_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_vehicle_economic_number_fkey FOREIGN KEY (vehicle_economic_number) REFERENCES public.vehicles(economic_number);


--
-- PostgreSQL database dump complete
--

