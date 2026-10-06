// Importar Firebase y Firestore desde los CDN oficiales
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Credenciales extraídas de tu consola de Firebase
const firebaseConfig = {
    apiKey: "AIzaSyDf2S8mcv-IRF114dfnABlLVkwkevC81U",
    authDomain: "gruas-mau.firebaseapp.com",
    projectId: "gruas-mau",
    storageBucket: "gruas-mau.firebasestorage.app",
    messagingSenderId: "378994590629",
    appId: "1:378994590629:web:31a8bf67b6521c20efde4c",
    measurementId: "G-4N6H438527"
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Función que maneja el formulario, guarda en la nube y abre WhatsApp
window.enviarSolicitudFirebase = async function() {
    const servicio = document.getElementById('servicio').value;
    const ubicacion = document.getElementById('ubicacion').value;
    const destino = document.getElementById('destino').value;
    const vehiculo = document.getElementById('vehiculo').value;

    // AQUI USAMOS LA NUEVA ALERTA PROFESIONAL
    if (!servicio || !ubicacion) {
        window.mostrarAlerta("Por favor, indícanos 'Qué necesita' y la 'Ubicación' para poder enviarte la grúa.", "warning");
        return;
    }

    const btnSubmit = document.querySelector('.btn-submit');
    btnSubmit.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Conectando...';
    btnSubmit.disabled = true;

    try {
        // 1. Guardar la solicitud en Firestore (Base de datos)
        await addDoc(collection(db, "solicitudes"), {
            servicio: servicio,
            ubicacion: ubicacion,
            destino: destino ? destino : 'No especificado',
            vehiculo: vehiculo ? vehiculo : 'No especificado',
            estado: 'Pendiente',
            fecha: serverTimestamp()
        });

        console.log("¡Solicitud guardada en Firebase exitosamente!");

        // 2. Armar el mensaje para WhatsApp
        let mensaje = `🚨 *NUEVA SOLICITUD - GRÚAS MAU* 🚨%0A%0A`;
        mensaje += `🛠️ *Servicio:* ${servicio}%0A`;
        mensaje += `📍 *Ubicación:* ${ubicacion}%0A`;
        mensaje += `🏁 *Llevar a:* ${destino ? destino : 'A convenir'}%0A`;
        mensaje += `🚚 *Carga:* ${vehiculo ? vehiculo : 'No especificado'}`;

        const telefono = "50688755921";
        const urlWhatsApp = `https://wa.me/${telefono}?text=${mensaje}`;
        
        // Abrir WhatsApp y mostrar alerta de éxito
        window.open(urlWhatsApp, '_blank');
        window.mostrarAlerta("¡Solicitud enviada con éxito! Revisa tu WhatsApp.", "success");
        
        document.getElementById('form-asistencia').reset();
        
    } catch (error) {
        console.error("Error al guardar en Firebase: ", error);
        
        // Resguardo: si la red falla, de igual forma abre el WhatsApp
        const telefono = "50688755921";
        let mensaje = `🚨 *SOLICITUD DE SERVICIO - GRÚAS MAU* 🚨%0A%0A🛠️ *Servicio:* ${servicio}%0A📍 *Ubicación:* ${ubicacion}`;
        window.open(`https://wa.me/${telefono}?text=${mensaje}`, '_blank');
    } finally {
        btnSubmit.innerHTML = '<i class="fab fa-whatsapp"></i> Enviar Pedido a WhatsApp';
        btnSubmit.disabled = false;
    }
};
