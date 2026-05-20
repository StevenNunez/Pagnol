
import { WorkItem } from '@/modules/core/lib/data';

// Usamos Omit para no tener que definir id, tenantId, etc. aquí
type SeedWorkItem = Omit<WorkItem, 'tenantId' | 'progress' | 'status'>;

export const WORK_ITEMS_SEED: SeedWorkItem[] = [
  {"id":"1","projectId":"1","name":"EDIFICIO TIENDA Y SERVICIOS","type":"project","parentId":null,"path":"01","unit":"global","quantity":1,"unitPrice":0, "createdBy": "system"},
  {"id":"2","projectId":"1","name":"OBRA GRUESA","type":"phase","parentId":"1","path":"01/01","unit":"global","quantity":1,"unitPrice":0, "createdBy": "system"},
  {"id":"3","projectId":"1","name":"MOVIMIENTO DE TIERRA","type":"subphase","parentId":"2","path":"01/01/01","unit":"global","quantity":1,"unitPrice":0, "createdBy": "system"},
  {"id":"4","projectId":"1","name":"Excavación y preparación de terreno","type":"activity","parentId":"3","path":"01/01/01/01","unit":"m3","quantity":1200,"unitPrice":0, "createdBy": "system"},
  {"id":"5","projectId":"1","name":"FUNDACIONES","type":"subphase","parentId":"2","path":"01/01/02","unit":"global","quantity":1,"unitPrice":0, "createdBy": "system"},
  {"id":"6","projectId":"1","name":"Trazado y replanteo","type":"activity","parentId":"5","path":"01/01/02/01","unit":"m2","quantity":2500,"unitPrice":0, "createdBy": "system"},
  {"id":"7","projectId":"1","name":"Enfierradura de fundaciones","type":"activity","parentId":"5","path":"01/01/02/02","unit":"kg","quantity":75000,"unitPrice":0, "createdBy": "system"},
  {"id":"8","projectId":"1","name":"Hormigonado de fundaciones","type":"activity","parentId":"5","path":"01/01/02/03","unit":"m3","quantity":950,"unitPrice":0, "createdBy": "system"},
  {"id":"9","projectId":"1","name":"ESTRUCTURA","type":"subphase","parentId":"2","path":"01/01/03","unit":"global","quantity":1,"unitPrice":0, "createdBy": "system"},
  {"id":"10","projectId":"1","name":"Montaje de estructura metálica","type":"activity","parentId":"9","path":"01/01/03/01","unit":"ton","quantity":450,"unitPrice":0, "createdBy": "system"},
  {"id":"11","projectId":"1","name":"Losas de hormigón","type":"activity","parentId":"9","path":"01/01/03/02","unit":"m2","quantity":7000,"unitPrice":0, "createdBy": "system"},
  {"id":"12","projectId":"1","name":"Tabiquería y albañilería","type":"activity","parentId":"9","path":"01/01/03/03","unit":"m2","quantity":5500,"unitPrice":0, "createdBy": "system"},
  {"id":"13","projectId":"1","name":"TERMINACIONES","type":"phase","parentId":"1","path":"01/02","unit":"global","quantity":1,"unitPrice":0, "createdBy": "system"},
  {"id":"14","projectId":"1","name":"CIELOS","type":"subphase","parentId":"13","path":"01/02/01","unit":"global","quantity":1,"unitPrice":0, "createdBy": "system"},
  {"id":"15","projectId":"1","name":"Cielo falso","type":"activity","parentId":"14","path":"01/02/01/01","unit":"m2","quantity":6800,"unitPrice":0, "createdBy": "system"},
  {"id":"16","projectId":"1","name":"PAVIMENTOS","type":"subphase","parentId":"13","path":"01/02/02","unit":"global","quantity":1,"unitPrice":0, "createdBy": "system"},
  {"id":"17","projectId":"1","name":"Instalación de cerámicas y porcelanatos","type":"activity","parentId":"16","path":"01/02/02/01","unit":"m2","quantity":4500,"unitPrice":0, "createdBy": "system"},
  {"id":"18","projectId":"1","name":"Pintura de alto tráfico","type":"activity","parentId":"16","path":"01/02/02/02","unit":"m2","quantity":2300,"unitPrice":0, "createdBy": "system"},
  {"id":"19","projectId":"1","name":"REVESTIMIENTOS Y PINTURA","type":"subphase","parentId":"13","path":"01/02/03","unit":"global","quantity":1,"unitPrice":0, "createdBy": "system"},
  {"id":"20","projectId":"1","name":"Estucos y enlucidos","type":"activity","parentId":"19","path":"01/02/03/01","unit":"m2","quantity":12000,"unitPrice":0, "createdBy": "system"},
  {"id":"21","projectId":"1","name":"Pintura interior y exterior","type":"activity","parentId":"19","path":"01/02/03/02","unit":"m2","quantity":25000,"unitPrice":0, "createdBy": "system"},
  {"id":"22","projectId":"1","name":"INSTALACIONES","type":"phase","parentId":"1","path":"01/03","unit":"global","quantity":1,"unitPrice":0, "createdBy": "system"},
  {"id":"23","projectId":"1","name":"SISTEMA ELÉCTRICO","type":"subphase","parentId":"22","path":"01/03/01","unit":"global","quantity":1,"unitPrice":0, "createdBy": "system"},
  {"id":"24","projectId":"1","name":"Canalizaciones y cableado","type":"activity","parentId":"23","path":"01/03/01/01","unit":"m","quantity":35000,"unitPrice":0, "createdBy": "system"},
  {"id":"25","projectId":"1","name":"Montaje de tableros y equipos","type":"activity","parentId":"23","path":"01/03/01/02","unit":"und","quantity":350,"unitPrice":0, "createdBy": "system"},
  {"id":"26","projectId":"1","name":"SISTEMA SANITARIO","type":"subphase","parentId":"22","path":"01/03/02","unit":"global","quantity":1,"unitPrice":0, "createdBy": "system"},
  {"id":"27","projectId":"1","name":"Red de agua potable","type":"activity","parentId":"26","path":"01/03/02/01","unit":"m","quantity":4500,"unitPrice":0, "createdBy": "system"},
  {"id":"28","projectId":"1","name":"Red de alcantarillado","type":"activity","parentId":"26","path":"01/03/02/02","unit":"m","quantity":4300,"unitPrice":0, "createdBy": "system"},
  {"id":"29","projectId":"1","name":"CLIMATIZACIÓN","type":"subphase","parentId":"22","path":"01/03/03","unit":"global","quantity":1,"unitPrice":0, "createdBy": "system"},
  {"id":"30","projectId":"1","name":"Instalación de ductos y equipos HVAC","type":"activity","parentId":"29","path":"01/03/03/01","unit":"und","quantity":120,"unitPrice":0, "createdBy": "system"},
  {"id":"31","projectId":"1","name":"ESTACIONAMIENTOS Y EXTERIORES","type":"project","parentId":null,"path":"02","unit":"global","quantity":1,"unitPrice":0, "createdBy": "system"},
  {"id":"32","projectId":"1","name":"PAVIMENTACIÓN","type":"phase","parentId":"31","path":"02/01","unit":"global","quantity":1,"unitPrice":0, "createdBy": "system"},
  {"id":"33","projectId":"1","name":"Preparación de base y subbase","type":"activity","parentId":"32","path":"02/01/01","unit":"m2","quantity":15000,"unitPrice":0, "createdBy": "system"},
  {"id":"34","projectId":"1","name":"Carpeta asfáltica","type":"activity","parentId":"32","path":"02/01/02","unit":"m2","quantity":15000,"unitPrice":0, "createdBy": "system"},
  {"id":"35","projectId":"1","name":"PAISAJISMO","type":"phase","parentId":"31","path":"02/02","unit":"global","quantity":1,"unitPrice":0, "createdBy": "system"},
  {"id":"36","projectId":"1","name":"Instalación de sistema de riego","type":"activity","parentId":"35","path":"02/02/01","unit":"global","quantity":1,"unitPrice":0, "createdBy": "system"},
  {"id":"37","projectId":"1","name":"Plantación de especies vegetales","type":"activity","parentId":"35","path":"02/02/02","unit":"und","quantity":800,"unitPrice":0, "createdBy": "system"},
  {"id":"38","projectId":"1","name":"OBRAS PRELIMINARES","type":"phase","parentId":"1","path":"01/00","unit":"global","quantity":1,"unitPrice":0, "createdBy": "system"},
  {"id":"39","projectId":"1","name":"Excavación y preparación de terreno","type":"activity","parentId":"38","path":"01/00/01","unit":"m3","quantity":1200,"unitPrice":0, "createdBy": "system"}
];
